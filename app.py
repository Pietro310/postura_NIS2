"""
Postura Cyber NIS2 — Backend Flask
Server principale per l'applicazione di assessment cyber NIS2.

Correzioni applicate:
- Sostituito WeasyPrint con fpdf2 (puro Python, zero dipendenze native)
- Abilitato invio email reale via SMTP
- Aggiunta validazione server-side dei dati richiedente
- Separazione chiara responsabilità endpoint
- Error handling robusto su PDF/email
- Logging strutturato
"""

import json
import os
import re
import base64
import logging
import smtplib
import random
import time
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from html import escape as html_escape
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_from_directory
from fpdf import FPDF
from dotenv import load_dotenv

# Carica variabili d'ambiente da file .env
load_dotenv()


# ── Memorizzazione OTP (per verifica email) ──
OTP_STORE = {}


# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('postura_nis2')

app = Flask(
    __name__,
    static_folder='static',
    template_folder='templates'
)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'

# ═══════════════════════════════════════════════════════════════
# CONFIGURAZIONE EMAIL
# Per disabilitare l'invio reale, impostare 'enabled': False
# ═══════════════════════════════════════════════════════════════
EMAIL_CONFIG = {
    'enabled': True,
    'smtp_host': os.environ.get('SMTP_HOST', 'smtp.gmail.com'),
    'smtp_port': int(os.environ.get('SMTP_PORT', '587')),
    'smtp_user': os.environ.get('SMTP_USER', ''),
    'smtp_password': os.environ.get('SMTP_PASSWORD', ''),
    'destinatario_admin': os.environ.get('ADMIN_EMAIL', ''),
    'nome_mittente': 'Globsit - Postura Cyber NIS2'
}


def load_questionario():
    """Carica il questionario dal file JSON."""
    with open(DATA_DIR / 'questionario.json', 'r', encoding='utf-8') as f:
        return json.load(f)


# ═══════════════════════════════════════════════════════════════
# MODULO VALIDAZIONE
# ═══════════════════════════════════════════════════════════════

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
PHONE_REGEX = re.compile(r'^[\+]?[\d\s\-\(\)]{6,20}$')


def sanitize_text(text: str) -> str:
    """Sanitizza testo per evitare injection in template HTML."""
    if not isinstance(text, str):
        return ''
    return html_escape(text.strip())


def validate_richiedente(dati: dict) -> tuple:
    """
    Valida i dati del richiedente lato server.
    Returns: (dati_sanitizzati, errori)
    """
    errori = []
    sanitized = {}

    # Email
    email = (dati.get('email', '') or '').strip().lower()
    if not email:
        errori.append('Email obbligatoria')
    elif not EMAIL_REGEX.match(email):
        errori.append('Formato email non valido')
    sanitized['email'] = email

    # Nome azienda
    nome = (dati.get('nome_azienda', '') or '').strip()
    if not nome:
        errori.append('Nome azienda obbligatorio')
    elif len(nome) < 2:
        errori.append('Nome azienda troppo corto')
    sanitized['nome_azienda'] = sanitize_text(nome)

    # Telefono
    telefono = (dati.get('telefono', '') or '').strip()
    if not telefono:
        errori.append('Telefono obbligatorio')
    elif not PHONE_REGEX.match(telefono):
        errori.append('Formato telefono non valido')
    sanitized['telefono'] = sanitize_text(telefono)

    # Privacy
    privacy = dati.get('privacy_accettata', False)
    if not privacy:
        errori.append("E' necessario accettare l'informativa sulla privacy")
    sanitized['privacy_accettata'] = True

    return sanitized, errori


# ═══════════════════════════════════════════════════════════════
# MODULO SCORING
# ═══════════════════════════════════════════════════════════════

SCORE_MAP = {
    'non applicabile': -1, 'n/a': -1,
    'no': 0, 'mai': 0, 'nessuno': 0, 'nessuna separazione': 0,
    'non ancora nominato': 0, 'non classificato': 0,
    'in valutazione': 1, 'informale': 1, 'solo su richiesta': 1, 'occasionale': 1,
    'parzialmente': 2, 'in corso': 2, 'parziale / in corso': 2,
    'solo alcuni': 2, 'solo per alcuni': 2, 'solo su alcuni sistemi': 2,
    'separati per ambiente': 3, 'sì (manuale)': 3, 'si (manuale)': 3,
    'solo i principali': 3, 'soggetto importante': 3,
    'sì (automatico)': 4, 'si (automatico)': 4, 'confermato': 4,
    'soggetto essenziale': 4, 'sì': 4, 'si': 4
}

PESI_MACROAREE = {
    '2. PROFILO NIS2': 5,
    '3. GOVERNANCE': 20,
    '4. INVENTARIO': 10,
    '5. FORMAZIONE': 10,
    '6. PROTEZIONE': 25,
    '7. RILEVAZIONE': 10,
    '8. RISPOSTA': 10,
    '9. RECUPERO': 5,
    '10. SUPPLY CHAIN': 5,
}


def calcola_score(risposte: dict) -> dict:
    """Calcola il punteggio di postura cyber."""
    questionario = load_questionario()

    scores_per_area = {}
    dettaglio_risposte = {}

    for sezione in questionario['sezioni']:
        if not sezione.get('scored', False):
            continue

        cat = sezione['categoria']
        punteggi = []

        for domanda in sezione['domande']:
            d_id = str(domanda['id'])
            risposta_raw = risposte.get(d_id, '')

            if not risposta_raw:
                continue

            if domanda['tipo'] in ('si_no', 'si_no_dettaglio'):
                score = 4 if risposta_raw.lower() in ('sì', 'si') else 0
                moltiplicatore = domanda.get('peso_moltiplicatore', 1.0)
                for _ in range(int(moltiplicatore)):
                    punteggi.append(score)
            else:
                score = SCORE_MAP.get(risposta_raw.lower().strip(), 2)
                if score == -1:
                    continue
                punteggi.append(score)

            dettaglio_risposte[d_id] = {
                'domanda': domanda['testo'],
                'risposta': risposta_raw,
                'score': score,
                'categoria': cat,
                'peso_speciale': domanda.get('peso_speciale', False)
            }

        if punteggi:
            media = sum(punteggi) / len(punteggi)
            percentuale = (media / 4) * 100
            scores_per_area[cat] = {
                'media_raw': round(media, 2),
                'percentuale': round(percentuale, 1),
                'n_domande': len(punteggi),
                'peso': PESI_MACROAREE.get(cat, 0)
            }

    somma_pesata = 0
    somma_pesi = 0
    for cat, data in scores_per_area.items():
        peso = data['peso']
        somma_pesata += data['percentuale'] * peso
        somma_pesi += peso

    score_finale = round(somma_pesata / somma_pesi, 1) if somma_pesi > 0 else 0

    if score_finale < 25:
        classe = 'Critica'
        colore = '#ef4444'
        desc_classe = "Contatta i nostri specialisti per pianificare una sessione di audit approfondita."
    elif score_finale < 50:
        classe = 'Debole'
        colore = '#f59e0b'
        desc_classe = "Contatta i nostri specialisti per pianificare una sessione di audit approfondita."
    elif score_finale < 75:
        classe = 'Adeguata'
        colore = '#3b82f6'
        desc_classe = "Contatta i nostri specialisti per pianificare una sessione di audit approfondita."
    else:
        classe = 'Avanzata'
        colore = '#10b981'
        desc_classe = "Contatta i nostri specialisti per pianificare una sessione di audit approfondita."

    punti_forza = []
    gap = []
    for cat, data in sorted(scores_per_area.items()):
        entry = {'area': cat, 'percentuale': data['percentuale']}
        if data['percentuale'] >= 60:
            punti_forza.append(entry)
        elif data['percentuale'] < 40:
            gap.append(entry)

    return {
        'score_totale': score_finale,
        'classe': classe,
        'colore_classe': colore,
        'descrizione_classe': desc_classe,
        'dettaglio_macroaree': scores_per_area,
        'punti_forza': punti_forza,
        'gap': gap,
        'dettaglio_risposte': dettaglio_risposte,
        'data_compilazione': datetime.now().strftime('%d/%m/%Y %H:%M')
    }


# ═══════════════════════════════════════════════════════════════
# MODULO GENERAZIONE PDF — fpdf2 (puro Python)
# ═══════════════════════════════════════════════════════════════

class ReportPDF(FPDF):
    """PDF professionale per report postura cyber NIS2."""

    ACCENT = (232, 126, 4)       # Arancione Globsit
    DARK = (26, 26, 46)          # Blu scuro
    TEXT = (55, 65, 81)          # Grigio testo
    MUTED = (107, 114, 128)      # Grigio muted
    BG_LIGHT = (249, 250, 251)   # Grigio chiarissimo
    WHITE = (255, 255, 255)

    def __init__(self, logo_path=None):
        super().__init__()
        self.logo_path = logo_path
        self.set_auto_page_break(auto=True, margin=20)

        # Font Unicode: usiamo Helvetica (built-in) per massima compatibilità
        # fpdf2 gestisce caratteri latin1 automaticamente

    def header(self):
        if self.logo_path and os.path.exists(self.logo_path):
            self.image(str(self.logo_path), 10, 8, 35)
        else:
            self.set_font('Helvetica', 'B', 14)
            self.set_text_color(*self.DARK)
            self.cell(35, 10, 'GLOBSIT', 0, 0)

        self.set_font('Helvetica', '', 7)
        self.set_text_color(*self.MUTED)
        self.cell(0, 5, 'Assessment Postura Cyber NIS2', 0, 1, 'R')
        self.set_y(self.get_y() + 2)

        # Linea arancione
        self.set_draw_color(*self.ACCENT)
        self.set_line_width(0.8)
        self.line(10, 20, 200, 20)
        self.set_y(24)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', '', 7)
        self.set_text_color(*self.MUTED)
        self.cell(0, 10, f'Pagina {self.page_no()}/{{nb}}', 0, 0, 'C')

    def section_title(self, title):
        self.set_font('Helvetica', 'B', 12)
        self.set_text_color(*self.ACCENT)
        self.cell(0, 8, self._safe(title), 0, 1)
        self.set_draw_color(229, 231, 235)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)

    def info_box(self, label, value):
        self.set_fill_color(*self.BG_LIGHT)
        x = self.get_x()
        y = self.get_y()
        self.rect(x, y, 88, 12, 'F')
        self.set_font('Helvetica', '', 6)
        self.set_text_color(*self.MUTED)
        self.set_xy(x + 3, y + 1)
        self.cell(82, 4, self._safe(label.upper()), 0, 2)
        self.set_font('Helvetica', 'B', 9)
        self.set_text_color(*self.DARK)
        self.cell(82, 5, self._safe(value), 0, 0)

    def _safe(self, text):
        """Converte testo per evitare problemi encoding fpdf."""
        if not isinstance(text, str):
            text = str(text)
        # Sostituisci caratteri non-latin1 con equivalenti
        replacements = {
            '\u2713': 'V',    # ✓
            '\u2717': 'X',    # ✗
            '\u2022': '-',    # •
            '\u2014': '-',    # —
            '\u2013': '-',    # –
            '\u201c': '"',    # "
            '\u201d': '"',    # "
            '\u2018': "'",    # '
            '\u2019': "'",    # '
            '\u00e0': 'a',    # à → meglio gestire con latin1
            '\u2026': '...',  # …
        }
        # In realtà fpdf2 gestisce latin1, quindi la maggior parte va bene
        # Forziamo solo i caratteri fuori latin1
        result = []
        for ch in text:
            try:
                ch.encode('latin-1')
                result.append(ch)
            except UnicodeEncodeError:
                result.append(replacements.get(ch, '?'))
        return ''.join(result)


def genera_pdf(dati_richiedente: dict, risultati: dict) -> bytes:
    """Genera il report PDF professionale con fpdf2."""
    try:
        logo_path = BASE_DIR / 'globsitlogo.png'
        pdf = ReportPDF(logo_path=str(logo_path) if logo_path.exists() else None)
        pdf.alias_nb_pages()
        pdf.add_page()

        # ── Titolo ──
        pdf.set_font('Helvetica', 'B', 18)
        pdf.set_text_color(*ReportPDF.DARK)
        pdf.cell(0, 10, 'Report Postura Cyber NIS2', 0, 1)
        pdf.set_font('Helvetica', '', 8)
        pdf.set_text_color(*ReportPDF.MUTED)
        pdf.cell(0, 5, f"Generato il {risultati['data_compilazione']}", 0, 1)
        pdf.ln(5)

        # ── Dati Richiedente ──
        pdf.section_title('Dati Richiedente')
        x_start = pdf.get_x()
        y_start = pdf.get_y()

        pdf.set_xy(x_start, y_start)
        pdf.info_box('Azienda', dati_richiedente.get('nome_azienda', 'N/D'))
        pdf.set_xy(x_start + 95, y_start)
        pdf.info_box('Email', dati_richiedente.get('email', 'N/D'))

        pdf.set_xy(x_start, y_start + 15)
        pdf.info_box('Telefono', dati_richiedente.get('telefono', 'N/D'))
        pdf.set_xy(x_start + 95, y_start + 15)
        pdf.info_box('Data Compilazione', risultati['data_compilazione'])

        pdf.set_y(y_start + 32)
        pdf.ln(3)

        # ── Score Box ──
        pdf.section_title('Risultato Assessment')

        # Colore classe
        colore_hex = risultati['colore_classe']
        r_c = int(colore_hex[1:3], 16)
        g_c = int(colore_hex[3:5], 16)
        b_c = int(colore_hex[5:7], 16)

        y_box = pdf.get_y()
        pdf.set_fill_color(249, 250, 251)
        pdf.set_draw_color(r_c, g_c, b_c)
        pdf.set_line_width(0.6)
        pdf.rect(10, y_box, 190, 28, 'DF')

        pdf.set_xy(15, y_box + 3)
        pdf.set_font('Helvetica', 'B', 28)
        pdf.set_text_color(r_c, g_c, b_c)
        pdf.cell(50, 12, f"{risultati['score_totale']}/100", 0, 0)

        pdf.set_xy(70, y_box + 3)
        pdf.set_font('Helvetica', 'B', 14)
        pdf.set_text_color(*ReportPDF.DARK)
        pdf.cell(0, 7, pdf._safe(f"Classe: {risultati['classe']}"), 0, 2)
        pdf.set_font('Helvetica', '', 8)
        pdf.set_text_color(*ReportPDF.TEXT)
        pdf.multi_cell(120, 4, pdf._safe(risultati['descrizione_classe']), 0)

        pdf.set_y(y_box + 33)

        # ── Dettaglio Macroaree ──
        pdf.section_title('Dettaglio per Macroarea')

        ordered_areas = sorted(risultati['dettaglio_macroaree'].items())
        for cat, data in ordered_areas:
            perc = data['percentuale']
            if perc >= 75:
                bar_r, bar_g, bar_b = 16, 185, 129
            elif perc >= 50:
                bar_r, bar_g, bar_b = 59, 130, 246
            elif perc >= 25:
                bar_r, bar_g, bar_b = 245, 158, 11
            else:
                bar_r, bar_g, bar_b = 239, 68, 68

            y_row = pdf.get_y()

            # Nome area
            pdf.set_font('Helvetica', '', 8)
            pdf.set_text_color(*ReportPDF.TEXT)
            pdf.set_xy(10, y_row)
            pdf.cell(55, 6, pdf._safe(cat), 0, 0)

            # Barra sfondo
            bar_x = 68
            bar_w = 105
            bar_h = 4
            bar_y = y_row + 1
            pdf.set_fill_color(229, 231, 235)
            pdf.rect(bar_x, bar_y, bar_w, bar_h, 'F')

            # Barra valore
            fill_w = max(1, bar_w * perc / 100)
            pdf.set_fill_color(bar_r, bar_g, bar_b)
            pdf.rect(bar_x, bar_y, fill_w, bar_h, 'F')

            # Percentuale
            pdf.set_font('Helvetica', 'B', 8)
            pdf.set_text_color(bar_r, bar_g, bar_b)
            pdf.set_xy(175, y_row)
            pdf.cell(25, 6, f"{perc}%", 0, 1, 'R')

            pdf.set_y(y_row + 8)

        pdf.ln(3)

        # ── Punti di Forza ──
        pdf.section_title('Punti di Forza')
        pdf.set_font('Helvetica', '', 9)
        if risultati['punti_forza']:
            for pf in risultati['punti_forza']:
                pdf.set_text_color(5, 150, 105)
                pdf.cell(0, 5, pdf._safe(f"  V  {pf['area']} - {pf['percentuale']}%"), 0, 1)
        else:
            pdf.set_text_color(*ReportPDF.MUTED)
            pdf.cell(0, 5, 'Nessun punto di forza significativo rilevato', 0, 1)
        pdf.ln(2)

        # ── Gap ──
        pdf.section_title('Principali Gap')
        pdf.set_font('Helvetica', '', 9)
        if risultati['gap']:
            for g in risultati['gap']:
                pdf.set_text_color(220, 38, 38)
                pdf.cell(0, 5, pdf._safe(f"  X  {g['area']} - {g['percentuale']}%"), 0, 1)
        else:
            pdf.set_text_color(*ReportPDF.MUTED)
            pdf.cell(0, 5, 'Nessun gap critico rilevato', 0, 1)
        pdf.ln(2)

        # ── Riepilogo Risposte ──
        pdf.add_page()
        pdf.section_title('Riepilogo Risposte')

        risposte_per_area = {}
        for d_id, det in risultati['dettaglio_risposte'].items():
            cat = det['categoria']
            if cat not in risposte_per_area:
                risposte_per_area[cat] = []
            risposte_per_area[cat].append(det)

        for cat in sorted(risposte_per_area.keys()):
            # Controlla se serve nuova pagina
            if pdf.get_y() > 250:
                pdf.add_page()

            pdf.set_font('Helvetica', 'B', 9)
            pdf.set_text_color(*ReportPDF.DARK)
            pdf.cell(0, 6, pdf._safe(cat), 0, 1)

            # Header tabella
            pdf.set_fill_color(*ReportPDF.DARK)
            pdf.set_text_color(*ReportPDF.WHITE)
            pdf.set_font('Helvetica', 'B', 7)
            y_h = pdf.get_y()
            pdf.cell(110, 6, '  Domanda', 0, 0, 'L', True)
            pdf.cell(50, 6, '  Risposta', 0, 0, 'L', True)
            pdf.cell(20, 6, 'Score', 0, 1, 'C', True)

            # Righe
            pdf.set_font('Helvetica', '', 7)
            fill = False
            for det in risposte_per_area[cat]:
                if pdf.get_y() > 270:
                    pdf.add_page()

                if fill:
                    pdf.set_fill_color(*ReportPDF.BG_LIGHT)
                else:
                    pdf.set_fill_color(*ReportPDF.WHITE)

                pdf.set_text_color(*ReportPDF.TEXT)

                domanda_text = det['domanda']
                if det.get('peso_speciale'):
                    domanda_text += ' [ALTO IMPATTO]'

                pdf.cell(110, 5, pdf._safe(f"  {domanda_text[:70]}"), 0, 0, 'L', True)
                pdf.cell(50, 5, pdf._safe(f"  {det['risposta'][:30]}"), 0, 0, 'L', True)
                pdf.set_text_color(*ReportPDF.DARK)
                pdf.cell(20, 5, f"{det['score']}/4", 0, 1, 'C', True)

                fill = not fill

            pdf.ln(4)

        # ── Disclaimer ──
        if pdf.get_y() > 240:
            pdf.add_page()

        pdf.ln(5)
        pdf.set_fill_color(254, 243, 199)
        pdf.set_draw_color(245, 158, 11)
        pdf.set_line_width(0.4)

        y_disc = pdf.get_y()
        disclaimer_text = (
            "Nota importante: Il presente report costituisce un assessment preliminare "
            "della postura di cybersecurity in ottica NIS2 e non rappresenta una certificazione "
            "ufficiale. I risultati hanno valore indicativo e devono essere integrati con "
            "un'analisi approfondita condotta da professionisti qualificati. Globsit non si "
            "assume responsabilita' per decisioni basate esclusivamente su questo assessment."
        )
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(146, 64, 14)

        # Sfondo disclaimer
        pdf.rect(10, y_disc, 190, 18, 'DF')
        pdf.line(10, y_disc, 10, y_disc + 18)  # barra laterale
        pdf.set_xy(13, y_disc + 2)
        pdf.multi_cell(184, 3.5, pdf._safe(disclaimer_text), 0)

        # ── Footer finale ──
        pdf.ln(8)
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(*ReportPDF.MUTED)
        pdf.cell(0, 4, pdf._safe(f"(c) {datetime.now().year} Globsit - Assessment Postura Cyber NIS2"), 0, 1, 'C')
        pdf.cell(0, 4, pdf._safe(f"Documento generato automaticamente il {risultati['data_compilazione']}"), 0, 1, 'C')

        pdf_bytes = pdf.output()
        logger.info(f"PDF generato con successo: {len(pdf_bytes)} bytes")
        return bytes(pdf_bytes)

    except Exception as e:
        logger.error(f"Errore generazione PDF: {e}", exc_info=True)
        raise


# ═══════════════════════════════════════════════════════════════
# MODULO EMAIL
# ═══════════════════════════════════════════════════════════════

def invia_email(destinatario: str, oggetto: str, corpo_html: str,
                allegato_pdf: bytes = None, nome_allegato: str = 'report.pdf') -> dict:
    """
    Funzione centralizzata per invio email.
    Se EMAIL_CONFIG['enabled'] è False, simula l'invio (mock).
    """
    if not EMAIL_CONFIG['enabled']:
        logger.info(f"[MOCK] Email simulata verso {destinatario} — oggetto: {oggetto}")
        return {
            'success': True,
            'mock': True,
            'messaggio': 'Invio email simulato. Abilitare EMAIL_CONFIG per invio reale.'
        }

    if not destinatario:
        logger.warning("Destinatario email vuoto, invio saltato")
        return {
            'success': False,
            'mock': False,
            'messaggio': 'Destinatario email mancante'
        }

    try:
        msg = MIMEMultipart()
        msg['From'] = f"{EMAIL_CONFIG['nome_mittente']} <{EMAIL_CONFIG['smtp_user']}>"
        msg['To'] = destinatario
        msg['Subject'] = oggetto

        msg.attach(MIMEText(corpo_html, 'html'))

        if allegato_pdf:
            attachment = MIMEApplication(allegato_pdf, _subtype='pdf')
            attachment.add_header('Content-Disposition', 'attachment', filename=nome_allegato)
            msg.attach(attachment)

        logger.info(f"Invio email a {destinatario}...")
        with smtplib.SMTP(EMAIL_CONFIG['smtp_host'], EMAIL_CONFIG['smtp_port'], timeout=15) as server:
            server.starttls()
            server.login(EMAIL_CONFIG['smtp_user'], EMAIL_CONFIG['smtp_password'])
            server.send_message(msg)

        logger.info(f"Email inviata con successo a {destinatario}")
        return {'success': True, 'mock': False, 'messaggio': 'Email inviata con successo.'}

    except smtplib.SMTPAuthenticationError as e:
        logger.error(f"Errore autenticazione SMTP: {e}")
        return {'success': False, 'mock': False, 'messaggio': 'Errore autenticazione SMTP. Verificare credenziali.'}
    except smtplib.SMTPException as e:
        logger.error(f"Errore SMTP: {e}")
        return {'success': False, 'mock': False, 'messaggio': f'Errore SMTP: {str(e)}'}
    except Exception as e:
        logger.error(f"Errore invio email: {e}", exc_info=True)
        return {'success': False, 'mock': False, 'messaggio': f'Errore invio email: {str(e)}'}


def prepara_email_admin(dati_richiedente: dict, risultati: dict, pdf_bytes: bytes) -> dict:
    """Invia email di notifica all'amministratore con report allegato."""
    corpo = f'''
    <html><body style="font-family:Arial,sans-serif;">
    <h2 style="color:#e87e04;">Nuovo calcolo postura effettuato</h2>
    <p>Di seguito i dettagli del richiedente e il riepilogo dello score calcolato:</p>
    <table style="border-collapse:collapse; margin:15px 0;">
        <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Azienda:</td><td>{html_escape(dati_richiedente.get('nome_azienda','N/D'))}</td></tr>
        <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Email:</td><td>{html_escape(dati_richiedente.get('email','N/D'))}</td></tr>
        <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Telefono:</td><td>{html_escape(dati_richiedente.get('telefono','N/D'))}</td></tr>
        <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Privacy Accettata:</td><td>Sì (consenso comunicazioni commerciali e newsletter confermato)</td></tr>
        <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Score:</td><td>{risultati['score_totale']}/100</td></tr>
        <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Classe:</td><td>{risultati['classe']}</td></tr>
    </table>
    <h3>Dettaglio Macroaree</h3>
    <ul>
    '''
    for cat, data in sorted(risultati['dettaglio_macroaree'].items()):
        corpo += f'<li>{html_escape(cat)}: {data["percentuale"]}%</li>'
    corpo += '''
    </ul>
    <p style="font-size:12px;color:#666;">In allegato il report PDF completo generato dal sistema.</p>
    </body></html>
    '''

    nome_file = f"report_postura_{dati_richiedente.get('nome_azienda','azienda').replace(' ','_')}_{datetime.now().strftime('%Y%m%d')}.pdf"

    return invia_email(
        destinatario=EMAIL_CONFIG['destinatario_admin'],
        oggetto=f"Nuovo calcolo postura effettuato - {dati_richiedente.get('nome_azienda','Azienda')}",
        corpo_html=corpo,
        allegato_pdf=pdf_bytes,
        nome_allegato=nome_file
    )


def prepara_email_richiedente(dati_richiedente: dict, risultati: dict, pdf_bytes: bytes) -> dict:
    """Invia email con report al richiedente."""
    corpo = f'''
    <html><body style="font-family:Arial,sans-serif;">
    <h2 style="color:#e87e04;">Il suo Report Postura Cyber NIS2</h2>
    <p>Gentile {html_escape(dati_richiedente.get('nome_azienda',''))},</p>
    <p>In allegato trova il report dell'assessment di postura cyber NIS2 effettuato.</p>
    <table style="border-collapse:collapse; margin:15px 0;">
        <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Score:</td><td style="font-size:18px;color:{risultati['colore_classe']};">{risultati['score_totale']}/100</td></tr>
        <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Classe:</td><td>{risultati['classe']}</td></tr>
    </table>
    <p>{html_escape(risultati['descrizione_classe'])}</p>
    <p style="font-size:12px;color:#666;">Questo assessment e' preliminare e non costituisce una certificazione ufficiale.</p>
    <p>Cordiali saluti,<br>Globsit - Cybersecurity</p>
    </body></html>
    '''

    nome_file = f"report_postura_NIS2_{datetime.now().strftime('%Y%m%d')}.pdf"

    return invia_email(
        destinatario=dati_richiedente.get('email', ''),
        oggetto='Report Postura Cyber NIS2 - Globsit',
        corpo_html=corpo,
        allegato_pdf=pdf_bytes,
        nome_allegato=nome_file
    )


# ═══════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/questionario')
def api_questionario():
    """Restituisce la struttura del questionario."""
    return jsonify(load_questionario())


@app.route('/api/valida-richiedente', methods=['POST'])
def api_valida_richiedente():
    """Validazione server-side dei dati richiedente."""
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'errori': ['Dati mancanti']}), 400

    dati_richiedente = data.get('dati_richiedente', {})
    sanitized, errori = validate_richiedente(dati_richiedente)

    if errori:
        return jsonify({'success': False, 'errori': errori}), 400

    return jsonify({'success': True, 'dati': sanitized})


@app.route('/api/richiedi-codice-verifica', methods=['POST'])
def api_richiedi_codice_verifica():
    """Genera e invia un codice OTP via email al richiedente per la verifica."""
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'errori': ['Dati mancanti']}), 400

    dati_richiedente = data.get('dati_richiedente', {})
    sanitized, errori = validate_richiedente(dati_richiedente)

    if errori:
        return jsonify({'success': False, 'errori': errori}), 400

    email = sanitized['email']
    codice = str(random.randint(100000, 999999))
    
    # Salva in RAM con timestamp
    OTP_STORE[email] = {
        'codice': codice,
        'timestamp': time.time()
    }
    
    # Invia email con il codice
    corpo_html = f'''
    <html><body style="font-family:Arial,sans-serif; color:#1a1a2e;">
    <h2 style="color:#e87e04;">Codice di Verifica Assessment NIS2</h2>
    <p>Gentile {html_escape(sanitized.get('nome_azienda', 'Utente'))},</p>
    <p>Per completare la verifica del suo indirizzo email e proseguire con l'assessment di postura cyber NIS2, inserisca il seguente codice di sicurezza:</p>
    <div style="background:#f3f4f6; border:2px solid #e87e04; border-radius:6px; padding:15px; text-align:center; font-size:24px; font-weight:bold; letter-spacing:4px; margin:20px 0; width:200px;">
        {codice}
    </div>
    <p style="font-size:12px; color:#6b7280;">Il codice ha una validita' di 15 minuti. Se non ha richiesto questo codice, ignori questa email.</p>
    <p>Cordiali saluti,<br>Globsit - Cybersecurity</p>
    </body></html>
    '''
    
    logger.info(f"Invio codice OTP {codice} a {email}...")
    res_mail = invia_email(
        destinatario=email,
        oggetto='Codice di Verifica Assessment NIS2 - Globsit',
        corpo_html=corpo_html
    )
    
    if res_mail.get('success'):
        return jsonify({'success': True, 'messaggio': 'Codice inviato con successo'})
    else:
        return jsonify({'success': False, 'errori': [f"Impossibile inviare l'email di verifica: {res_mail.get('messaggio')}"]}), 500


@app.route('/api/verifica-codice', methods=['POST'])
def api_verifica_codice():
    """Verifica il codice OTP inviato all'utente."""
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'errore': 'Dati mancanti'}), 400

    email = (data.get('email', '') or '').strip().lower()
    codice = (data.get('codice', '') or '').strip()
    dati_richiedente = data.get('dati_richiedente', {})

    if not email or not codice:
        return jsonify({'success': False, 'errore': 'Email o codice mancante'}), 400

    record = OTP_STORE.get(email)
    if not record:
        return jsonify({'success': False, 'errore': 'Nessun codice richiesto per questa email o codice scaduto'}), 400

    # Scadenza 15 minuti
    if time.time() - record['timestamp'] > 900:
        OTP_STORE.pop(email, None)
        return jsonify({'success': False, 'errore': 'Codice scaduto. Richiedine uno nuovo.'}), 400

    if record['codice'] == codice:
        OTP_STORE.pop(email, None)  # Verificato con successo
        logger.info(f"Email {email} verificata con successo tramite OTP.")

        # Invio notifica email all'amministratore con i dati di contatto verificati
        try:
            sanitized, _ = validate_richiedente(dati_richiedente)
            if not sanitized:
                sanitized = {
                    'email': email,
                    'nome_azienda': dati_richiedente.get('nome_azienda', 'N/D'),
                    'telefono': dati_richiedente.get('telefono', 'N/D')
                }

            corpo_notifica = f'''
            <html><body style="font-family:Arial,sans-serif; color:#1a1a2e;">
            <h2 style="color:#e87e04;">Nuovo calcolo postura effettuato</h2>
            <p>Un utente ha appena completato e verificato con successo i propri dati di contatto per avviare il questionario di postura cyber NIS2.</p>
            <table style="border-collapse:collapse; margin:15px 0;">
                <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Azienda:</td><td>{html_escape(sanitized.get('nome_azienda','N/D'))}</td></tr>
                <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Email:</td><td>{html_escape(sanitized.get('email', email))}</td></tr>
                <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Telefono:</td><td>{html_escape(sanitized.get('telefono','N/D'))}</td></tr>
                <tr><td style="padding:5px 15px 5px 0;font-weight:bold;">Privacy Accettata:</td><td>Sì (consenso comunicazioni commerciali e newsletter confermato)</td></tr>
            </table>
            <p style="font-size:12px; color:#6b7280;">L'utente sta ora compilando le sezioni del questionario.</p>
            <p>Globsit - Cybersecurity</p>
            </body></html>
            '''
            logger.info(f"Invio email notifica di verifica OTP all'admin per {sanitized.get('nome_azienda')}...")
            invia_email(
                destinatario=EMAIL_CONFIG['destinatario_admin'],
                oggetto='Nuovo calcolo postura effettuato',
                corpo_html=corpo_notifica
            )
        except Exception as e_mail:
            logger.error(f"Errore invio email notifica admin post-verifica OTP: {e_mail}", exc_info=True)

        return jsonify({'success': True, 'messaggio': 'Email verificata con successo'})
    else:
        return jsonify({'success': False, 'errore': 'Codice di verifica errato'}), 400


@app.route('/api/calcola', methods=['POST'])
def api_calcola():
    """Calcola lo score a partire dalle risposte inviate e notifica l'amministratore."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'errore': 'Dati mancanti'}), 400

        risposte = data.get('risposte', {})
        dati_richiedente = data.get('dati_richiedente', {})

        # Validazione server-side
        sanitized, errori = validate_richiedente(dati_richiedente)
        if errori:
            return jsonify({'success': False, 'errori': errori}), 400

        risultati = calcola_score(risposte)
        logger.info(f"Assessment calcolato: {sanitized['nome_azienda']} — Score: {risultati['score_totale']}/100 ({risultati['classe']})")

        # Genera PDF e invia automaticamente all'amministratore
        stato_invio_admin = {'success': False, 'messaggio': 'Non avviato'}
        try:
            pdf_bytes = genera_pdf(sanitized, risultati)
            logger.info(f"Avvio invio email automatico all'amministratore per {sanitized['nome_azienda']}...")
            stato_invio_admin = prepara_email_admin(sanitized, risultati, pdf_bytes)
            if stato_invio_admin.get('success'):
                logger.info("Email automatica inviata all'admin con successo.")
            else:
                logger.error(f"Fallimento invio email automatica all'admin: {stato_invio_admin.get('messaggio')}")
        except Exception as e_pdf:
            logger.error(f"Errore durante la generazione PDF o l'invio automatico all'admin: {e_pdf}", exc_info=True)
            stato_invio_admin = {'success': False, 'messaggio': f"Errore interno: {str(e_pdf)}"}

        return jsonify({
            'success': True,
            'risultati': risultati,
            'dati_richiedente': sanitized,
            'stato_invio_admin': stato_invio_admin
        })
    except Exception as e:
        logger.error(f"Errore calcolo score: {e}", exc_info=True)
        return jsonify({'success': False, 'errore': 'Errore interno nel calcolo'}), 500


@app.route('/api/genera-pdf', methods=['POST'])
def api_genera_pdf():
    """Genera e restituisce il PDF del report."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'errore': 'Dati mancanti'}), 400

        risposte = data.get('risposte', {})
        dati_richiedente = data.get('dati_richiedente', {})

        sanitized, errori = validate_richiedente(dati_richiedente)
        if errori:
            return jsonify({'success': False, 'errori': errori}), 400

        risultati = calcola_score(risposte)
        pdf_bytes = genera_pdf(sanitized, risultati)

        pdf_b64 = base64.b64encode(pdf_bytes).decode('utf-8')
        filename = f"report_postura_NIS2_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"

        logger.info(f"PDF scaricato: {sanitized['nome_azienda']}")

        return jsonify({
            'success': True,
            'pdf_base64': pdf_b64,
            'filename': filename
        })
    except Exception as e:
        logger.error(f"Errore generazione PDF: {e}", exc_info=True)
        return jsonify({'success': False, 'errore': f'Errore generazione PDF: {str(e)}'}), 500


@app.route('/api/invia-report', methods=['POST'])
def api_invia_report():
    """
    Genera il PDF e invia email al richiedente e all'admin.
    Questo è il punto dove partono TUTTE le email.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'errore': 'Dati mancanti'}), 400

        risposte = data.get('risposte', {})
        dati_richiedente = data.get('dati_richiedente', {})

        sanitized, errori = validate_richiedente(dati_richiedente)
        if errori:
            return jsonify({'success': False, 'errori': errori}), 400

        risultati = calcola_score(risposte)

        # Genera PDF
        try:
            pdf_bytes = genera_pdf(sanitized, risultati)
        except Exception as e:
            logger.error(f"PDF generation fallita durante invio report: {e}")
            return jsonify({
                'success': False,
                'errore': f'Errore generazione PDF: {str(e)}'
            }), 500

        # Invia email al richiedente
        risultato_richiedente = prepara_email_richiedente(sanitized, risultati, pdf_bytes)

        # Invia email all'admin
        risultato_admin = prepara_email_admin(sanitized, risultati, pdf_bytes)

        # Logga risultato
        logger.info(
            f"Invio report per {sanitized['nome_azienda']}: "
            f"richiedente={'OK' if risultato_richiedente['success'] else 'FAIL'}, "
            f"admin={'OK' if risultato_admin['success'] else 'FAIL'}"
        )

        return jsonify({
            'success': True,
            'email_richiedente': risultato_richiedente,
            'email_admin': risultato_admin,
            'pdf_base64': base64.b64encode(pdf_bytes).decode('utf-8'),
            'filename': f"report_postura_NIS2_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        })

    except Exception as e:
        logger.error(f"Errore invio report: {e}", exc_info=True)
        return jsonify({'success': False, 'errore': f'Errore: {str(e)}'}), 500


@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)


if __name__ == '__main__':
    logger.info("=" * 60)
    logger.info("Postura Cyber NIS2 — Avvio server")
    logger.info(f"Email invio reale: {'ABILITATO' if EMAIL_CONFIG['enabled'] else 'DISABILITATO (mock)'}")
    if EMAIL_CONFIG['enabled']:
        logger.info(f"SMTP: {EMAIL_CONFIG['smtp_host']}:{EMAIL_CONFIG['smtp_port']}")
        logger.info(f"Admin destinatario: {EMAIL_CONFIG['destinatario_admin']}")
    logger.info("=" * 60)
    app.run(host='0.0.0.0', debug=True, port=5006)
