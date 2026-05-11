#!/usr/bin/env python3
from fpdf import FPDF

class MarketPollenPDF(FPDF):
    GOLD = (245, 166, 35)
    DARK = (45, 45, 45)
    GRAY = (100, 100, 100)
    LIGHT_BG = (255, 248, 235)
    WHITE = (255, 255, 255)

    def header(self):
        pass

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*self.GRAY)
        self.cell(0, 10, "marketpollen.com", align="C")

    def add_title_page(self):
        self.add_page()
        self.set_fill_color(*self.LIGHT_BG)
        self.rect(0, 0, 210, 297, "F")

        self.ln(80)
        self.set_font("Helvetica", "B", 36)
        self.set_text_color(*self.DARK)
        self.cell(0, 15, "MARKET POLLEN", align="C", new_x="LMARGIN", new_y="NEXT")

        self.ln(5)
        self.set_draw_color(*self.GOLD)
        self.set_line_width(1.5)
        self.line(60, self.get_y(), 150, self.get_y())
        self.ln(10)

        self.set_font("Helvetica", "", 16)
        self.set_text_color(*self.GRAY)
        self.cell(0, 10, "Your AI-Powered Field Marketing Command Center", align="C", new_x="LMARGIN", new_y="NEXT")

        self.ln(30)
        self.set_font("Helvetica", "I", 13)
        self.set_text_color(*self.DARK)
        self.multi_cell(0, 8, "For field marketers who build relationships, not spreadsheets.", align="C")

    def add_section(self, title, items):
        self.ln(6)
        self.set_fill_color(*self.GOLD)
        self.rect(15, self.get_y(), 4, 8, "F")
        self.set_x(23)
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(*self.DARK)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(3)

        for item in items:
            self.set_x(23)
            self.set_font("Helvetica", "", 10)
            self.set_text_color(*self.GRAY)

            bullet_text = f"-  {item}"
            self.multi_cell(170, 6, bullet_text)
            self.ln(1.5)

    def add_content(self):
        self.add_page()

        self.set_font("Helvetica", "B", 20)
        self.set_text_color(*self.DARK)
        self.cell(0, 12, "What Market Pollen Does For You", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(3)
        self.set_font("Helvetica", "", 11)
        self.set_text_color(*self.GRAY)
        self.multi_cell(0, 6, "Market Pollen replaces scattered spreadsheets, forgotten follow-ups, and manual data entry with a single AI-driven platform built for field marketers who are on the road every day.", align="C")
        self.ln(5)

        self.add_section("Plan Your Day in 30 Seconds", [
            "Open your day planner and instantly see who you need to follow up with, what to say, and the best way to reach them.",
            "AI analyzes each contact's history and recommends the right timing -- not just \"tomorrow\" but based on relationship stage and urgency.",
            "Get an optimized driving route from your store to every opportunity, ready to open in Google Maps with one tap.",
        ])

        self.add_section("Log Visits Without Slowing Down", [
            "Dictate your notes after a visit. AI extracts the contact name, business, reachout type, products given, and personal details automatically.",
            "No forms to fill out, no dropdowns to navigate. Speak naturally: \"Talked to Sarah at Lewis Bank, dropped off a sample tray, she loves hiking.\"",
            "Every interaction is logged with full context -- type, date, notes, and any donations -- in one step.",
        ])

        self.add_section("Generate Personalized Emails Instantly", [
            "AI writes outreach emails using everything it knows: past visits, donations, personal interests, and upcoming events.",
            "Don't like the tone? Type one line of feedback (\"make it shorter\" or \"mention the holiday\") and it regenerates.",
            "Copy the email, send it from your own inbox, and log it as a tracked reachout -- all without leaving the app.",
        ])

        self.add_section("Never Lose Track of a Follow-Up", [
            "AI suggests follow-up dates based on where each relationship stands -- new leads get shorter windows, established contacts get longer ones.",
            "Add follow-ups directly to your Google or Apple calendar with one click. Get email reminders with full event details.",
            "Mark follow-ups as done when completed. They disappear from your planner so you always see what's still open.",
        ])

        # Page 3
        self.add_page()

        self.add_section("Discover New Opportunities Nearby", [
            "Find potential businesses near your store through Google Places -- restaurants, event centers, banks, offices.",
            "When you visit a prospect and create a contact, Market Pollen auto-links the opportunity. No duplicate businesses, no manual matching.",
            "Track which opportunities you've visited, converted, or dismissed. Focus your energy where it counts.",
        ])

        self.add_section("Track Progress Toward Your Goals", [
            "Every product you give out -- bundtlet cards, sample trays, cakes -- counts toward your quarterly \"mouths reached\" goal.",
            "Watch your progress bar climb in real-time after every logged interaction. Hit 100% and the tracker turns gold.",
            "Managers see progress across all stores at a glance. Individual contributors see their own store's numbers front and center.",
        ])

        self.add_section("Report Without the Busywork", [
            "Export your donation data to Excel with one click. Columns adjust dynamically based on your product lineup.",
            "Organization-level exports generate a multi-sheet spreadsheet -- one tab per store -- ready for leadership review.",
            "All data is real-time. No end-of-week summaries to compile, no numbers to reconcile.",
        ])

        self.add_section("Manage Your Entire Team From One Place", [
            "Invite team members with granular permissions: view-only or edit access, scoped to specific stores.",
            "Set organization-wide quarterly goals. Every store inherits the same target automatically.",
            "Add or remove campaign products, adjust mouth values, and toggle what's active -- changes apply everywhere instantly.",
        ])

        # Closing
        self.ln(10)
        self.set_draw_color(*self.GOLD)
        self.set_line_width(1)
        self.line(30, self.get_y(), 180, self.get_y())
        self.ln(10)

        self.set_font("Helvetica", "B", 16)
        self.set_text_color(*self.DARK)
        self.multi_cell(0, 10, "Stop managing spreadsheets.\nStart closing relationships.", align="C")

        self.ln(8)
        self.set_font("Helvetica", "", 12)
        self.set_text_color(*self.GRAY)
        self.cell(0, 8, "marketpollen.com", align="C", new_x="LMARGIN", new_y="NEXT")


pdf = MarketPollenPDF()
pdf.set_auto_page_break(auto=True, margin=20)
pdf.add_title_page()
pdf.add_content()
pdf.output("/Users/taylanwhite/marketpollen/Market_Pollen_Overview.pdf")
print("PDF created: Market_Pollen_Overview.pdf")
