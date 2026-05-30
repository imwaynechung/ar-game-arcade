"""Builds the 銀齡遊樂園 / Silver-Age Playground sales pitch deck (16:9 PPTX)."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# ---- Theme ----
CORAL = RGBColor(0xEF, 0x81, 0x73)
INK = RGBColor(0x0A, 0x15, 0x30)
GOLD = RGBColor(0xFF, 0xD2, 0x3F)
CREAM = RGBColor(0xFF, 0xF8, 0xE8)
GREEN = RGBColor(0x3C, 0xD0, 0x6A)
GRAY = RGBColor(0x66, 0x66, 0x66)
LIGHT_GRAY = RGBColor(0xEE, 0xEE, 0xEE)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
SW, SH = prs.slide_width, prs.slide_height

blank = prs.slide_layouts[6]


def add_slide():
    s = prs.slides.add_slide(blank)
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SW, SH)
    bg.line.fill.background()
    bg.fill.solid()
    bg.fill.fore_color.rgb = WHITE
    bg.shadow.inherit = False
    return s


def add_text(slide, x, y, w, h, text, size=18, bold=False, color=INK,
             align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, font='Helvetica'):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.05)
    tf.margin_top = tf.margin_bottom = Inches(0.02)
    tf.vertical_anchor = anchor
    lines = text.split('\n') if isinstance(text, str) else text
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = line
        r.font.name = font
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
    return tb


def add_rect(slide, x, y, w, h, fill=CORAL, line=None, shape=MSO_SHAPE.ROUNDED_RECTANGLE):
    r = slide.shapes.add_shape(shape, x, y, w, h)
    r.fill.solid()
    r.fill.fore_color.rgb = fill
    if line is None:
        r.line.fill.background()
    else:
        r.line.color.rgb = line
        r.line.width = Pt(1.5)
    r.shadow.inherit = False
    return r


def add_footer(slide, page, total):
    add_rect(slide, 0, Inches(7.25), SW, Inches(0.25), fill=CORAL, shape=MSO_SHAPE.RECTANGLE)
    add_text(slide, Inches(0.4), Inches(7.27), Inches(8), Inches(0.22),
             '銀齡遊樂園 · Silver-Age Playground', size=10, bold=True, color=WHITE)
    add_text(slide, Inches(11.5), Inches(7.27), Inches(1.5), Inches(0.22),
             f'{page} / {total}', size=10, bold=True, color=WHITE, align=PP_ALIGN.RIGHT)


def add_header(slide, kicker, title, subtitle=None):
    add_rect(slide, 0, 0, SW, Inches(0.18), fill=CORAL, shape=MSO_SHAPE.RECTANGLE)
    if kicker:
        add_text(slide, Inches(0.6), Inches(0.35), Inches(12), Inches(0.35),
                 kicker.upper(), size=12, bold=True, color=CORAL)
    add_text(slide, Inches(0.6), Inches(0.7), Inches(12), Inches(0.8),
             title, size=32, bold=True, color=INK)
    if subtitle:
        add_text(slide, Inches(0.6), Inches(1.55), Inches(12), Inches(0.5),
                 subtitle, size=16, color=GRAY)


def add_table(slide, x, y, w, h, data, header_fill=INK, header_fg=WHITE,
              first_col_bold=True, font_size=12, header_size=12, zebra=True,
              col_widths=None, highlight_col=None, highlight_fill=None):
    rows, cols = len(data), len(data[0])
    tbl_shape = slide.shapes.add_table(rows, cols, x, y, w, h)
    tbl = tbl_shape.table
    if col_widths:
        total = sum(col_widths)
        for ci, cw in enumerate(col_widths):
            tbl.columns[ci].width = int(w * cw / total)
    for ri, row in enumerate(data):
        for ci, val in enumerate(row):
            cell = tbl.cell(ri, ci)
            cell.margin_left = Inches(0.08)
            cell.margin_right = Inches(0.08)
            cell.margin_top = Inches(0.05)
            cell.margin_bottom = Inches(0.05)
            if ri == 0:
                cell.fill.solid(); cell.fill.fore_color.rgb = header_fill
            elif highlight_col is not None and ci == highlight_col:
                cell.fill.solid(); cell.fill.fore_color.rgb = highlight_fill or CREAM
            elif zebra and ri % 2 == 0:
                cell.fill.solid(); cell.fill.fore_color.rgb = LIGHT_GRAY
            else:
                cell.fill.solid(); cell.fill.fore_color.rgb = WHITE
            tf = cell.text_frame
            tf.word_wrap = True
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf.paragraphs[0].text = ''
            p = tf.paragraphs[0]
            r = p.add_run()
            r.text = str(val)
            r.font.name = 'Helvetica'
            if ri == 0:
                r.font.size = Pt(header_size); r.font.bold = True; r.font.color.rgb = header_fg
            else:
                r.font.size = Pt(font_size)
                r.font.color.rgb = INK
                if first_col_bold and ci == 0:
                    r.font.bold = True
    return tbl


# ============== SLIDE 1 — Cover ==============
def slide_cover():
    s = add_slide()
    add_rect(s, 0, 0, SW, SH, fill=CORAL, shape=MSO_SHAPE.RECTANGLE)
    add_rect(s, Inches(1.5), Inches(1.2), Inches(10.33), Inches(5.1), fill=CREAM)
    add_text(s, Inches(2), Inches(1.5), Inches(9.3), Inches(0.5),
             '2026 SALES PITCH', size=14, bold=True, color=CORAL)
    add_text(s, Inches(2), Inches(2.0), Inches(9.3), Inches(1.3),
             '銀齡遊樂園', size=72, bold=True, color=INK)
    add_text(s, Inches(2), Inches(3.2), Inches(9.3), Inches(0.7),
             'Silver-Age Playground', size=32, bold=True, color=CORAL)
    add_text(s, Inches(2), Inches(4.0), Inches(9.3), Inches(0.6),
             '一部鏡頭，全院長者動起來', size=22, bold=True, color=INK)
    add_text(s, Inches(2), Inches(4.6), Inches(9.3), Inches(0.5),
             'Camera-powered cognitive + motion arcade for HK elderly care',
             size=16, color=GRAY)
    add_rect(s, Inches(2), Inches(5.5), Inches(4.6), Inches(0.6), fill=INK)
    add_text(s, Inches(2), Inches(5.55), Inches(4.6), Inches(0.5),
             'ar-game-arcade.vercel.app', size=16, bold=True,
             color=GOLD, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


# ============== SLIDE 2 — Problem ==============
def slide_problem():
    s = add_slide()
    add_header(s, '01 · The market', '香港正在快速老化',
               'Hong Kong is ageing faster than almost any city on earth.')
    stats = [
        ('1 / 3', '香港人 ≥ 65 歲', 'by 2046 (政府統計處)'),
        ('330,000', '認知障礙症患者', 'projected 2039'),
        ('42 mo', 'RCHE 院舍輪候期', 'average wait time'),
        ('40 %+', '護理員缺口', 'caregiver shortage'),
    ]
    cx = Inches(0.6); cy = Inches(2.3)
    cw = Inches(2.95); ch = Inches(3.4); gap = Inches(0.18)
    for i, (big, mid, sub) in enumerate(stats):
        x = cx + (cw + gap) * i
        add_rect(s, x, cy, cw, ch, fill=CREAM)
        add_text(s, x, cy + Inches(0.4), cw, Inches(1.4),
                 big, size=44, bold=True, color=CORAL, align=PP_ALIGN.CENTER)
        add_text(s, x, cy + Inches(1.8), cw, Inches(0.6),
                 mid, size=18, bold=True, color=INK, align=PP_ALIGN.CENTER)
        add_text(s, x, cy + Inches(2.5), cw, Inches(0.6),
                 sub, size=13, color=GRAY, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.6), Inches(6.0), Inches(12), Inches(0.8),
             '院舍急需可規模化、可量度、可申資助的日常活動方案。',
             size=18, bold=True, color=INK, align=PP_ALIGN.CENTER)
    add_footer(s, 2, 16)


# ============== SLIDE 3 — Pain points ==============
def slide_pain():
    s = add_slide()
    add_header(s, '02 · The gap', '現有方案的痛點',
               'Nothing on the market combines motion + cognition + group + data.')
    data = [
        ['現有方案 Solution', '主要問題 Pain'],
        ['紙本工作紙 / Bingo', '重覆、悶、無數據追蹤'],
        ['YouTube 椅子操影片', '無互動、無報告、無 accountability'],
        ['NeuroGym 智能麻雀枱 (HKSTP)', 'HK$80K+ 硬件，淨係動手指'],
        ['Motiview 單車 (Norway)', '單一動作，要買 stationary bike'],
        ['VR 頭盔 (Rendever / MyndVR)', '長者抗拒戴、易眩暈、HK$200K+'],
    ]
    add_table(s, Inches(0.6), Inches(2.2), Inches(12.1), Inches(4.4),
              data, font_size=15, header_size=14, col_widths=[5, 7])
    add_footer(s, 3, 16)


# ============== SLIDE 4 — Solution ==============
def slide_solution():
    s = add_slide()
    add_header(s, '03 · Our solution', '銀齡遊樂園 — 一部筆電 + 一個 USB 鏡頭',
               '= 整個動感認知遊樂園')
    items = [
        ('AI', 'AI 體感偵測', 'MediaPipe pose engine — 全身動作，毋須控制器'),
        ('6', '6 大認知範疇', '專注、記憶、執行、語言、視覺空間、眼手協調'),
        ('1-4', '1–4 人同屏對戰', '院友一齊玩，唔再孤獨訓練'),
        ('PDF', '自動報告', '個人 / 院舍 / 跨院舍 dashboard'),
        ('$', '可申樂齡基金', 'BLSAA / I&T Fund — 我哋代你寫申請'),
        ('5K', '硬件門檻零', '一部 PC + USB 鏡頭就玩到，~HK$5K'),
    ]
    bx = Inches(0.6); by = Inches(2.3)
    bw = Inches(6.05); bh = Inches(1.45); gx = Inches(0.2); gy = Inches(0.2)
    for i, (badge, ttl, body) in enumerate(items):
        col = i % 2; row = i // 2
        x = bx + (bw + gx) * col
        y = by + (bh + gy) * row
        add_rect(s, x, y, bw, bh, fill=CREAM)
        add_rect(s, x + Inches(0.2), y + Inches(0.25), Inches(0.85), Inches(0.85),
                 fill=CORAL, shape=MSO_SHAPE.OVAL)
        add_text(s, x + Inches(0.2), y + Inches(0.25), Inches(0.85), Inches(0.85),
                 badge, size=18, bold=True, color=WHITE,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        add_text(s, x + Inches(1.2), y + Inches(0.2), bw - Inches(1.3), Inches(0.45),
                 ttl, size=16, bold=True, color=CORAL)
        add_text(s, x + Inches(1.2), y + Inches(0.7), bw - Inches(1.3), Inches(0.7),
                 body, size=12, color=INK)
    add_footer(s, 4, 16)


# ============== SLIDE 5 — Clinical framework ==============
def slide_framework():
    s = add_slide()
    add_header(s, '04 · Clinical framework', '6 大臨床範疇 — 每款遊戲都對位',
               'Every game maps to one or more validated assessment domains.')
    domains = [
        ('🏃', 'Physical / Motor',          '體能 · 動作',
         'Cadence, ROM, endurance — march, paddle, gallop, lift.'),
        ('🧠', 'Cognitive',                 '認知 · 反應',
         'Attention, memory, executive function — sort, recall, count.'),
        ('👁️', 'Hand–Eye Coordination',     '眼手協調',
         'Tracking + timing — fruit ninja, balloon pop, catch.'),
        ('🧭', 'Visual–Spatial',            '視覺空間',
         'Depth, direction, mental rotation — steer, aim, navigate.'),
        ('🧩', 'Dual-Task',                 '雙重任務',
         'Cognitive + motor at once — march while solving math.'),
        ('⚖️', 'Fall Risk / Balance',       '跌倒風險 · 平衡',
         'Single-leg, weight-shift, sway — Berg-style on-screen tests.'),
    ]
    bx = Inches(0.4); by = Inches(2.05)
    bw = Inches(4.1); bh = Inches(1.55); gx = Inches(0.18); gy = Inches(0.18)
    for i, (emoji, en, zh, body) in enumerate(domains):
        col = i % 3; row = i // 3
        x = bx + (bw + gx) * col
        y = by + (bh + gy) * row
        add_rect(s, x, y, bw, bh, fill=CREAM, line=CORAL)
        add_rect(s, x + Inches(0.18), y + Inches(0.22), Inches(0.85), Inches(0.85),
                 fill=CORAL, shape=MSO_SHAPE.OVAL)
        add_text(s, x + Inches(0.18), y + Inches(0.22), Inches(0.85), Inches(0.85),
                 emoji, size=24, bold=True, color=WHITE,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        add_text(s, x + Inches(1.15), y + Inches(0.18), bw - Inches(1.25), Inches(0.4),
                 en, size=14, bold=True, color=CORAL)
        add_text(s, x + Inches(1.15), y + Inches(0.55), bw - Inches(1.25), Inches(0.32),
                 zh, size=11, color=GRAY, bold=True)
        add_text(s, x + Inches(0.18), y + Inches(1.05), bw - Inches(0.32), Inches(0.45),
                 body, size=10, color=INK)
    add_text(s, Inches(0.4), Inches(5.5), Inches(12.5), Inches(0.4),
             'Every report covers all 6 domains · pre/post comparison · BLSAA-ready KPIs',
             size=13, bold=True, color=CORAL, align=PP_ALIGN.CENTER)
    add_footer(s, 5, 16)


# ============== SLIDE 6 — Games ==============
def slide_games():
    s = add_slide()
    add_header(s, '04 · Product', '8 款已上線，每月新增 2 款',
               'Target: 30+ games within 12 months.')
    games = [
        ('顏色分類', 'Color Baskets', '執行 + 反應'),
        ('水果接力', 'Fruit Catch', '眼手協調'),
        ('水果忍者', 'Fruit Ninja', '視覺空間 + 力度'),
        ('氣球轟炸', 'Balloon Pop', '專注 + 預測'),
        ('賽馬比賽', 'Horse Race', '體能耐力'),
        ('龍舟賽', 'Dragon Boat', '上身協調'),
        ('數字衝刺', 'Number Rush', '算術 + 記憶'),
        ('教練跟練', 'Coach Follow', '姿態模仿 (八段錦)'),
    ]
    bx = Inches(0.6); by = Inches(2.25)
    bw = Inches(2.95); bh = Inches(1.55); gx = Inches(0.18); gy = Inches(0.18)
    for i, (zh, en, tag) in enumerate(games):
        col = i % 4; row = i // 4
        x = bx + (bw + gx) * col
        y = by + (bh + gy) * row
        add_rect(s, x, y, bw, bh, fill=CREAM)
        # number badge
        add_rect(s, x + Inches(0.2), y + Inches(0.2), Inches(0.5), Inches(0.5),
                 fill=CORAL, shape=MSO_SHAPE.OVAL)
        add_text(s, x + Inches(0.2), y + Inches(0.2), Inches(0.5), Inches(0.5),
                 str(i + 1), size=14, bold=True, color=WHITE,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        add_text(s, x + Inches(0.85), y + Inches(0.25), bw - Inches(1), Inches(0.5),
                 zh, size=16, bold=True, color=INK)
        add_text(s, x + Inches(0.2), y + Inches(0.85), bw - Inches(0.4), Inches(0.35),
                 en, size=12, color=CORAL, bold=True)
        add_text(s, x + Inches(0.2), y + Inches(1.18), bw - Inches(0.4), Inches(0.3),
                 tag, size=11, color=GRAY)
    add_text(s, Inches(0.6), Inches(6.0), Inches(12), Inches(0.5),
             'Roadmap: +2 games / month  →  30+ titles by EOY 2027',
             size=14, bold=True, color=CORAL, align=PP_ALIGN.CENTER)
    add_footer(s, 6, 16)


# ============== SLIDE 6 — Competitor matrix ==============
def slide_competitors():
    s = add_slide()
    add_header(s, '05 · Competitive landscape', '我哋 vs NeuroGym vs Motiview', None)
    data = [
        ['', 'NeuroGym (HKSTP)', 'Motiview (Norway)', '銀齡遊樂園'],
        ['遊戲數', '70+ 認知', '1,800 影片', '8 → 30+'],
        ['輸入方式', '觸控 / 麻雀枱', '單車 + 螢幕', 'AI 體感鏡頭'],
        ['全身動作', '✗', '單車 only', '✓'],
        ['多人對戰', '同枱限定', '✗', '✓ 1v1 / 2v2'],
        ['6 大認知報告', '✓', '✗', '✓'],
        ['硬件門檻', 'HK$30K–80K', 'HK$15K + 單車', 'HK$0 / 15K'],
        ['年費 (HKD)', '$30K–60K (不透明)', '$25K–40K', '$0 / $11.7K / $28.8K / 15K+'],
        ['公開定價', '✗', '✗', '✓'],
        ['免費試玩', '✗', '✗', '✓'],
        ['樂齡基金代辦', '✓', '✗', '✓'],
    ]
    add_table(s, Inches(0.6), Inches(2.2), Inches(12.1), Inches(4.7),
              data, font_size=11, header_size=12,
              col_widths=[2.0, 2.4, 2.4, 2.4],
              highlight_col=3, highlight_fill=CREAM)
    add_footer(s, 7, 16)


# ============== SLIDE 7 — Pricing ==============
def slide_pricing():
    s = add_slide()
    add_header(s, '08 · Pricing', '四層收費 — 由免費到企業',
               'Free / Pro / Plus / Enterprise — wedge in via Free, scale through Plus, lock-in via Enterprise.')
    tiers = [
        ('FREE', '試玩版', 'HKD $0', 'forever',
         ['3 款輪替遊戲', '5 min × 10 / day', '1 部裝置',
          '匿名 — 無報告', 'Watermark 品牌', '社群支援'], WHITE, LIGHT_GRAY),
        ('PRO', '標準版', 'HKD $980', '/ month',
         ['全部遊戲 + 每月新增', '20 位院友帳戶', '1 間院舍',
          '基本 PDF 報告', '中心 logo 品牌', 'WhatsApp 支援'], CREAM, CORAL),
        ('PLUS', '旗艦版', 'HKD $2,400', '/ month',
         ['Pro 全部功能', '50 位院友 / 5 staff', '6 大領域臨床報告',
          '跌倒風險 + 對比', '全白標 + 客製域名', 'BLSAA 申請 kit'], WHITE, INK),
        ('ENTERPRISE', '企業版', 'From $15K', '/ month',
         ['多院舍 / 集團', '無限院友 + seats', '專屬 CSM + API/EHR',
          'BLSAA 代辦服務', '院舍營運培訓', 'SLA + on-site 支援'], INK, GOLD),
    ]
    cx = Inches(0.45); cy = Inches(2.15)
    cw = Inches(2.95); ch = Inches(4.85); gap = Inches(0.16)
    for i, (code, name, price, period, bullets, fill, border) in enumerate(tiers):
        x = cx + (cw + gap) * i
        add_rect(s, x, cy, cw, ch, fill=fill, line=border)
        add_rect(s, x, cy, cw, Inches(0.12), fill=border, shape=MSO_SHAPE.RECTANGLE)
        title_color = WHITE if fill == INK else border
        body_color = WHITE if fill == INK else INK
        meta_color = LIGHT_GRAY if fill == INK else GRAY
        add_text(s, x, cy + Inches(0.4), cw, Inches(0.5), code,
                 size=18, bold=True, color=title_color, align=PP_ALIGN.CENTER)
        add_text(s, x, cy + Inches(0.95), cw, Inches(0.4), name,
                 size=12, color=meta_color, align=PP_ALIGN.CENTER)
        add_text(s, x, cy + Inches(1.45), cw, Inches(0.6), price,
                 size=22, bold=True, color=body_color, align=PP_ALIGN.CENTER)
        add_text(s, x, cy + Inches(2.05), cw, Inches(0.3), period,
                 size=10, color=meta_color, align=PP_ALIGN.CENTER)
        for bi, b in enumerate(bullets):
            add_text(s, x + Inches(0.22), cy + Inches(2.55 + bi * 0.32),
                     cw - Inches(0.3), Inches(0.3),
                     '•  ' + b, size=10, color=body_color)
    add_footer(s, 8, 16)


# ============== SLIDE 8 — Free moat ==============
def slide_free_moat():
    s = add_slide()
    add_header(s, '07 · The wedge', 'Free 是我哋最大競爭優勢',
               'No competitor offers a free tier. We do.')
    points = [
        ('60s', '60 秒上手', '社工 Google → 下載 → 即玩，毋須採購流程'),
        ('VIR', '病毒式擴散', '員工 → 同事 → 管理層 → 簽 Pro'),
        ('LEAD', 'Lead funnel', '每個免費用戶 = 一個已知 RCHE / NGO email'),
        ('PR', 'PR 角度', '「免費捐贈全港 300 間長者中心」→ 報紙頭條'),
        ('MOAT', '防守城牆', '院舍一旦上手，唔會轉買 NeuroGym'),
        ('$0', '零邊際成本', '一個 server 服務 1000 個 free user'),
    ]
    bx = Inches(0.6); by = Inches(2.3)
    bw = Inches(6.05); bh = Inches(1.4); gx = Inches(0.2); gy = Inches(0.2)
    for i, (badge, ttl, body) in enumerate(points):
        col = i % 2; row = i // 2
        x = bx + (bw + gx) * col
        y = by + (bh + gy) * row
        add_rect(s, x, y, bw, bh, fill=CREAM)
        add_rect(s, x + Inches(0.2), y + Inches(0.25), Inches(0.85), Inches(0.85),
                 fill=CORAL, shape=MSO_SHAPE.OVAL)
        add_text(s, x + Inches(0.2), y + Inches(0.25), Inches(0.85), Inches(0.85),
                 badge, size=11, bold=True, color=WHITE,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        add_text(s, x + Inches(1.2), y + Inches(0.15), bw - Inches(1.3), Inches(0.45),
                 ttl, size=15, bold=True, color=CORAL)
        add_text(s, x + Inches(1.2), y + Inches(0.6), bw - Inches(1.3), Inches(0.75),
                 body, size=11, color=INK)
    add_footer(s, 9, 16)


# ============== SLIDE 9 — Why buy ==============
def slide_why_buy():
    s = add_slide()
    add_header(s, '08 · Buyer motivation', '為什麼院舍會升級到 Pro / Plus', None)
    reasons = [
        ('1', '慳人手', '一個社工同時帶 8 位院友玩，無需 1-on-1'),
        ('2', '可量度', '自動 PDF 報告 → 應付 SQS 服務質素標準審核'),
        ('3', '可申資助', 'BLSAA 每間院舍最多 HK$1M — 等於 41 年 Plus 月費'),
        ('4', '取代多儀器', '一個 sub 取代買單車 + 踏步機 + 麻雀枱'),
        ('5', '群體活動', '院友期待、家屬睇到、董事會買單'),
    ]
    by = Inches(2.3); bh = Inches(0.85); gy = Inches(0.1)
    for i, (n, ttl, body) in enumerate(reasons):
        y = by + (bh + gy) * i
        add_rect(s, Inches(0.6), y, Inches(12.1), bh, fill=CREAM)
        add_rect(s, Inches(0.75), y + Inches(0.15), Inches(0.55), Inches(0.55),
                 fill=CORAL, shape=MSO_SHAPE.OVAL)
        add_text(s, Inches(0.75), y + Inches(0.15), Inches(0.55), Inches(0.55),
                 n, size=20, bold=True, color=WHITE,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        add_text(s, Inches(1.5), y + Inches(0.1), Inches(3.5), Inches(0.45),
                 ttl, size=16, bold=True, color=INK)
        add_text(s, Inches(1.5), y + Inches(0.45), Inches(11), Inches(0.4),
                 body, size=12, color=GRAY)
    add_footer(s, 10, 16)


# ============== SLIDE 10 — Customer journey ==============
def slide_journey():
    s = add_slide()
    add_header(s, '09 · Customer journey', '由 Free 到 Plus 的客戶旅程',
               'Self-serve funnel — no 4-week sales cycle like NeuroGym.')
    steps = [
        ('Day 0', '社工 Google search', 'Free 下載，即玩', CORAL),
        ('Day 7', '院友主動要求多遊戲', '升 Pro $980/mo', GOLD),
        ('Day 30', '管理層看 PDF 報告', '全院推行 Pro', GREEN),
        ('Day 60', '申請 BLSAA 基金', '加裝硬件 bundle', INK),
        ('Day 180', '集團 5 間院舍跟隨', '升 Plus $2,400/mo', CORAL),
    ]
    by = Inches(2.6); sw = Inches(2.35); sh = Inches(2.8); gap = Inches(0.15)
    cx = Inches(0.6)
    for i, (day, ttl, body, color) in enumerate(steps):
        x = cx + (sw + gap) * i
        add_rect(s, x, by, sw, sh, fill=color)
        add_text(s, x, by + Inches(0.3), sw, Inches(0.5), day,
                 size=14, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        add_rect(s, x + Inches(0.4), by + Inches(0.95), sw - Inches(0.8), Inches(0.03),
                 fill=WHITE, shape=MSO_SHAPE.RECTANGLE)
        add_text(s, x + Inches(0.15), by + Inches(1.1), sw - Inches(0.3), Inches(0.8),
                 ttl, size=13, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        add_text(s, x + Inches(0.15), by + Inches(1.9), sw - Inches(0.3), Inches(0.8),
                 body, size=11, color=WHITE, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.6), Inches(5.7), Inches(12), Inches(0.4),
             '對比 NeuroGym：Day 0 = 打電話排期 demo，2–4 週後先收到 quote。',
             size=12, color=GRAY, align=PP_ALIGN.CENTER)
    add_footer(s, 11, 16)


# ============== SLIDE 11 — Unit economics ==============
def slide_economics():
    s = add_slide()
    add_header(s, '10 · Unit economics', '商業模式',
               'High-margin SaaS, low CAC via Free funnel.')
    data = [
        ['指標 Metric', '估算 Estimate', '備註 Note'],
        ['客單價 (Pro 年費)', 'HKD $11,760', '12 × $980'],
        ['客單價 (Plus 年費)', 'HKD $28,800', '12 × $2,400'],
        ['客單價 (Enterprise)', 'HKD $180K+', '12 × $15K (起跳)'],
        ['毛利率 Gross margin', '85 %+', '純 SaaS，無硬件 inventory'],
        ['CAC (從 Free 轉換)', '< HKD $500', '主要係 onboarding 時間'],
        ['LTV (3 年留存)', 'HKD $35K – $540K', '院舍裝咗就唔換'],
        ['LTV / CAC', '> 70 ×', '健康 benchmark = 3-5 ×'],
        ['Payback period', '< 1 month', '一單就回本 CAC'],
        ['Break-even', '第 30 個 Pro 客戶', '~5 個月內可達'],
    ]
    add_table(s, Inches(0.6), Inches(2.2), Inches(12.1), Inches(4.7),
              data, font_size=13, header_size=12,
              col_widths=[3, 3, 6])
    add_footer(s, 12, 16)


# ============== SLIDE 12 — Roadmap ==============
def slide_roadmap():
    s = add_slide()
    add_header(s, '11 · Roadmap', '12 個月路線圖', None)
    quarters = [
        ('Q3 2026', '上線', ['Free + Pro 公測', '院友帳戶系統',
                          '6 大認知報告 PDF', '8 → 12 款遊戲'], CORAL),
        ('Q4 2026', '擴充', ['推出 Plus 旗艦版', '多院舍 dashboard',
                          '白標 + 跌倒風險', '16 款遊戲'], GOLD),
        ('Q1 2027', '商業', ['BLSAA 代辦服務', '集團案例 ×3',
                          'API integration', '20 款遊戲'], GREEN),
        ('Q2 2027', '擴張', ['進軍澳門/大灣區', '醫院 OT/Psych 部',
                          '客製化遊戲', '24 款遊戲'], INK),
    ]
    bx = Inches(0.6); by = Inches(2.25)
    bw = Inches(2.95); bh = Inches(4.5); gx = Inches(0.18)
    for i, (q, theme, items, color) in enumerate(quarters):
        x = bx + (bw + gx) * i
        add_rect(s, x, by, bw, bh, fill=WHITE, line=color)
        add_rect(s, x, by, bw, Inches(0.75), fill=color, shape=MSO_SHAPE.RECTANGLE)
        add_text(s, x, by + Inches(0.1), bw, Inches(0.4), q,
                 size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        add_text(s, x, by + Inches(0.45), bw, Inches(0.3), theme,
                 size=11, color=WHITE, align=PP_ALIGN.CENTER)
        for bi, it in enumerate(items):
            add_text(s, x + Inches(0.2), by + Inches(1.0 + bi * 0.7),
                     bw - Inches(0.3), Inches(0.65),
                     '✓  ' + it, size=12, color=INK)
    add_footer(s, 13, 16)


# ============== SLIDE 13 — TAM ==============
def slide_tam():
    s = add_slide()
    add_header(s, '12 · Market size', 'TAM 市場規模 (Hong Kong)',
               '~HK$18.5M ARR locally. 3-5× with GBA + SEA.')
    data = [
        ['Segment', '單位 Units', '年費 ARR/unit', '總 TAM Total'],
        ['RCHE 院舍', '~800', 'HKD $11,760 (Pro)', 'HKD $9.4M'],
        ['DECC / NEC 長者中心', '~210', 'HKD $11,760 (Pro)', 'HKD $2.5M'],
        ['醫院 OT / Psych 部', '~43', 'HKD $28,800 (Plus)', 'HKD $1.2M'],
        ['NGO 集團 (東華/保良/聖公會)', '~30', 'HKD $180K (Enterprise)', 'HKD $5.4M'],
        ['HK Total ARR', '~1,083', '—', 'HKD $18.5M'],
        ['+ Macau / GBA / SEA (3–5×)', '—', '—', 'HKD $55–93M'],
    ]
    add_table(s, Inches(0.6), Inches(2.3), Inches(12.1), Inches(4.4),
              data, font_size=13, header_size=12,
              col_widths=[4, 2, 3, 3])
    add_footer(s, 14, 16)


# ============== SLIDE 14 — Why us ==============
def slide_why_us():
    s = add_slide()
    add_header(s, '13 · The team', '為什麼是我哋', None)
    points = [
        ('TECH', 'GOFA 核心技術', 'MediaPipe pose engine 已驗證於跌倒評估產品'),
        ('SAAS', '多租戶 SaaS', '一個 codebase 服務多個院舍，已 production-ready'),
        ('NET', 'HKSTP / 政府生態', '直通 BLSAA、JC ChariTech、SIE Fund 渠道'),
        ('SPD', '內容速度', '已交付 8 款，每月加 2 款 (16 週發布 cadence)'),
        ('LIGHT', '無硬件包袱', '對手要養硬件供應鏈，我哋 100% software margin'),
        ('BI', '雙語團隊', '本地長者文化 + 國際 best practice'),
    ]
    bx = Inches(0.6); by = Inches(2.3)
    bw = Inches(6.05); bh = Inches(1.4); gx = Inches(0.2); gy = Inches(0.2)
    for i, (badge, ttl, body) in enumerate(points):
        col = i % 2; row = i // 2
        x = bx + (bw + gx) * col
        y = by + (bh + gy) * row
        add_rect(s, x, y, bw, bh, fill=CREAM)
        add_rect(s, x + Inches(0.2), y + Inches(0.25), Inches(0.9), Inches(0.85),
                 fill=CORAL, shape=MSO_SHAPE.OVAL)
        add_text(s, x + Inches(0.2), y + Inches(0.25), Inches(0.9), Inches(0.85),
                 badge, size=11, bold=True, color=WHITE,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        add_text(s, x + Inches(1.25), y + Inches(0.15), bw - Inches(1.35), Inches(0.45),
                 ttl, size=15, bold=True, color=CORAL)
        add_text(s, x + Inches(1.25), y + Inches(0.6), bw - Inches(1.35), Inches(0.75),
                 body, size=11, color=INK)
    add_footer(s, 15, 16)


# ============== SLIDE 15 — CTA ==============
def slide_cta():
    s = add_slide()
    add_rect(s, 0, 0, SW, SH, fill=INK, shape=MSO_SHAPE.RECTANGLE)
    add_text(s, Inches(0.6), Inches(1.0), Inches(12.1), Inches(0.5),
             'NEXT STEPS', size=14, bold=True, color=CORAL, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.6), Inches(1.5), Inches(12.1), Inches(1.2),
             '即試 · 即傾 · 即簽', size=54, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.6), Inches(2.8), Inches(12.1), Inches(0.5),
             'Try it · Talk to us · Sign up', size=20, color=GOLD,
             align=PP_ALIGN.CENTER)
    cards = [
        ('TRY 試玩', 'ar-game-arcade.vercel.app', '免費 · 60 秒上手'),
        ('TALK 聯絡', 'hello@gofa.co', 'WhatsApp / Email'),
        ('DEMO 安排', '30 min Zoom or on-site', 'Pro / Plus / 集團方案'),
    ]
    cx = Inches(0.9); cy = Inches(3.8)
    cw = Inches(3.85); ch = Inches(2.4); gap = Inches(0.2)
    for i, (ttl, mid, sub) in enumerate(cards):
        x = cx + (cw + gap) * i
        add_rect(s, x, cy, cw, ch, fill=CREAM)
        add_text(s, x, cy + Inches(0.3), cw, Inches(0.5), ttl,
                 size=18, bold=True, color=CORAL, align=PP_ALIGN.CENTER)
        add_text(s, x, cy + Inches(1.0), cw, Inches(0.6), mid,
                 size=15, bold=True, color=INK, align=PP_ALIGN.CENTER)
        add_text(s, x, cy + Inches(1.7), cw, Inches(0.4), sub,
                 size=11, color=GRAY, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.6), Inches(6.7), Inches(12.1), Inches(0.5),
             '銀齡遊樂園 — 讓長者再次玩起來', size=14, bold=True,
             color=GOLD, align=PP_ALIGN.CENTER)


# ---- Build ----
slide_cover()
slide_problem()
slide_pain()
slide_solution()
slide_framework()
slide_games()
slide_competitors()
slide_pricing()
slide_free_moat()
slide_why_buy()
slide_journey()
slide_economics()
slide_roadmap()
slide_tam()
slide_why_us()
slide_cta()

out = 'decks/silver-arcade-pitch.pptx'
prs.save(out)
print(f'OK wrote {out} ({len(prs.slides)} slides)')
