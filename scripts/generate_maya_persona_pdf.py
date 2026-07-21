from pathlib import Path
import textwrap


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "maya-chen-persona-summary.pdf"

PAGE_WIDTH = 612
PAGE_HEIGHT = 792
MARGIN_X = 54


def escape_pdf_text(value):
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


def rgb(r, g, b):
    return f"{r:.3f} {g:.3f} {b:.3f} rg"


def draw_rect(commands, x, y, width, height, color):
    commands.append(f"q {rgb(*color)} {x:.1f} {y:.1f} {width:.1f} {height:.1f} re f Q")


def draw_text(commands, text, x, y, size=11, font="F1", color=(0.13, 0.20, 0.21)):
    safe = escape_pdf_text(text)
    commands.append(f"BT /{font} {size} Tf {rgb(*color)} {x:.1f} {y:.1f} Td ({safe}) Tj ET")


def draw_wrapped(commands, text, x, y, width_chars=86, size=11, leading=15, font="F1", color=(0.26, 0.35, 0.36)):
    lines = []
    for paragraph in str(text).split("\n"):
        if not paragraph.strip():
            lines.append("")
            continue
        lines.extend(textwrap.wrap(paragraph, width=width_chars))

    cursor = y
    for line in lines:
        if line:
            draw_text(commands, line, x, cursor, size=size, font=font, color=color)
        cursor -= leading
    return cursor


def build_content():
    commands = []
    draw_rect(commands, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, (0.965, 0.990, 0.970))
    draw_rect(commands, 0, PAGE_HEIGHT - 128, PAGE_WIDTH, 128, (0.875, 0.955, 0.930))
    draw_rect(commands, 42, PAGE_HEIGHT - 104, 528, 1.2, (0.10, 0.55, 0.50))

    draw_text(commands, "Syntrae Persona Summary", MARGIN_X, 724, size=13, font="F2", color=(0.07, 0.45, 0.41))
    draw_text(commands, "Maya Chen", MARGIN_X, 686, size=34, font="F2", color=(0.12, 0.20, 0.21))
    draw_text(commands, "Private context summary for a considerate relationship decision", MARGIN_X, 666, size=12, color=(0.36, 0.45, 0.46))

    y = 622
    draw_text(commands, "Core Snapshot", MARGIN_X, y, size=16, font="F2", color=(0.12, 0.20, 0.21))
    y -= 22
    y = draw_wrapped(
        commands,
        "Maya Chen is a 22-year-old student at San Francisco State University in San Francisco. "
        "She is warm, reflective, and careful with tone when a relationship moment carries real emotional stakes. "
        "Her current goal is to invite Daniel into a clearer conversation about where the relationship is going while keeping the message respectful, calm, and easy to answer honestly.",
        MARGIN_X,
        y,
        width_chars=88,
        size=11,
        leading=15,
    )

    y -= 18
    draw_text(commands, "Communication Pattern", MARGIN_X, y, size=16, font="F2", color=(0.12, 0.20, 0.21))
    y -= 22
    y = draw_wrapped(
        commands,
        "Maya communicates best when she can be sincere without overloading the other person. "
        "She prefers plain language, a low-pressure invitation, and enough emotional clarity that the other person understands what matters. "
        "When uncertainty rises, she may be tempted to explain too much, so the strongest support style is concise, warm, and grounded.",
        MARGIN_X,
        y,
        width_chars=88,
        size=11,
        leading=15,
    )

    y -= 18
    draw_text(commands, "Decision Context", MARGIN_X, y, size=16, font="F2", color=(0.12, 0.20, 0.21))
    y -= 22
    y = draw_wrapped(
        commands,
        "The decision is high-stakes because Maya has one real-world message to send and incomplete information about Daniel's reaction. "
        "She wants to avoid making Daniel feel cornered, rushed, or responsible for her anxiety. "
        "Syntrae should help her compare possible paths before she acts, not promise an outcome or remove her responsibility for the final choice.",
        MARGIN_X,
        y,
        width_chars=88,
        size=11,
        leading=15,
    )

    y -= 18
    draw_text(commands, "Analytic Summary", MARGIN_X, y, size=16, font="F2", color=(0.12, 0.20, 0.21))
    y -= 22
    y = draw_wrapped(
        commands,
        "Maya's strongest signals are emotional awareness, patience, and willingness to name what she wants with care. "
        "Her main risk is adding too much explanation when the moment would benefit from a lighter opening. "
        "The best recommendation style should preserve warmth, give Daniel room to choose his pace, and make the next step clear enough that ambiguity does not keep building.",
        MARGIN_X,
        y,
        width_chars=88,
        size=11,
        leading=15,
    )

    y -= 26
    draw_rect(commands, 54, y - 70, 504, 86, (1.000, 0.982, 0.900))
    draw_text(commands, "Conclusion", 72, y - 4, size=14, font="F2", color=(0.12, 0.20, 0.21))
    draw_wrapped(
        commands,
        "Maya is most likely to act well when she can rehearse the difference between clarity and pressure. "
        "She benefits from messages that sound direct enough to be understood but gentle enough to preserve Daniel's sense of choice. "
        "For this decision, the strongest path is a warm invitation with one clear purpose and room for Daniel to respond naturally.",
        72,
        y - 24,
        width_chars=80,
        size=10.5,
        leading=14,
        color=(0.24, 0.32, 0.33),
    )

    draw_text(commands, "Syntrae LLC - Demo persona document", MARGIN_X, 34, size=9, color=(0.45, 0.54, 0.55))
    return "\n".join(commands).encode("latin-1")


def write_pdf(content):
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream",
    ]

    output = bytearray()
    output.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(obj)
        output.extend(b"\nendobj\n")

    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        (
            "trailer\n"
            f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            "startxref\n"
            f"{xref_offset}\n"
            "%%EOF\n"
        ).encode("ascii")
    )
    OUTPUT.write_bytes(output)


if __name__ == "__main__":
    write_pdf(build_content())
    print(OUTPUT)
