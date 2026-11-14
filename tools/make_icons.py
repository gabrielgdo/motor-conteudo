#!/usr/bin/env python3
"""Gera os ícones do PWA com Pillow.

Fundo vinho #6E1F2C, círculo rosé #EFD6CE com uma onda suave e um "M" serifado vinho.
Todo o conteúdo fica dentro do círculo central de 80% (zona segura de ícone maskable).

Uso: python3 tools/make_icons.py   (grava em icons/)
"""

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

VINHO = (0x6E, 0x1F, 0x2C, 255)
ROSE = (0xEF, 0xD6, 0xCE, 255)
ROSE_ESCURO = (0xE2, 0xBF, 0xB4, 255)

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "icons")

# Fontes serifadas comuns em Linux/macOS/Windows; a primeira que existir é usada.
FONTES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSerif-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSerif-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSerif-Bold.ttf",
    "/usr/share/fonts/noto/NotoSerif-Bold.ttf",
    "/Library/Fonts/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "C:/Windows/Fonts/georgiab.ttf",
    "DejaVuSerif-Bold.ttf",  # deixa o Pillow procurar no caminho padrão
]


def achar_fonte(tamanho):
    for caminho in FONTES:
        try:
            return ImageFont.truetype(caminho, tamanho)
        except (OSError, IOError):
            continue
    return None


def desenhar_m_poligonos(d, cx, cy, altura, cor):
    """M serifado desenhado com polígonos (usado se não houver fonte serifada)."""
    h = altura
    w = h * 1.05
    x0, y0 = cx - w / 2, cy - h / 2
    haste = h * 0.13  # espessura das hastes grossas
    fina = h * 0.06  # espessura das diagonais finas
    serifa_l = h * 0.12
    serifa_a = h * 0.05

    def ret(x, y, ww, hh):
        d.rectangle([x, y, x + ww, y + hh], fill=cor)

    # hastes verticais
    ret(x0 + serifa_l * 0.5, y0, fina * 1.2, h)  # esquerda (fina)
    ret(x0 + w - serifa_l * 0.5 - haste, y0, haste, h)  # direita (grossa)
    # diagonal esquerda (grossa) do topo esquerdo até o vale
    vale_x, vale_y = cx, y0 + h * 0.92
    d.polygon([
        (x0 + serifa_l * 0.5, y0), (x0 + serifa_l * 0.5 + haste, y0),
        (vale_x + haste * 0.25, vale_y), (vale_x - haste * 0.55, vale_y),
    ], fill=cor)
    # diagonal direita (fina) do vale ao topo direito
    d.polygon([
        (vale_x - fina * 0.3, vale_y), (vale_x + fina * 0.7, vale_y),
        (x0 + w - serifa_l * 0.5 - haste + fina, y0), (x0 + w - serifa_l * 0.5 - haste, y0),
    ], fill=cor)
    # serifas
    ret(x0, y0, serifa_l * 1.6, serifa_a)
    ret(x0 + w - serifa_l * 1.1 - haste, y0, serifa_l * 0.9 + haste, serifa_a)
    ret(x0, y0 + h - serifa_a, serifa_l * 1.6, serifa_a)
    ret(x0 + w - serifa_l * 1.1 - haste, y0 + h - serifa_a, serifa_l * 1.6 + haste, serifa_a)


def desenhar(tamanho_final):
    escala = 4 if tamanho_final < 256 else 2  # supersampling para bordas suaves
    s = tamanho_final * escala
    img = Image.new("RGBA", (s, s), VINHO)
    d = ImageDraw.Draw(img)
    cx = cy = s / 2

    # círculo rosé: raio 34% do lado (dentro do círculo seguro de 40%)
    r = s * 0.34
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ROSE)

    # onda suave na parte de baixo do círculo (recortada pelo círculo)
    onda = Image.new("L", (s, s), 0)
    od = ImageDraw.Draw(onda)
    pontos = []
    base = cy + r * 0.48
    amp = r * 0.07
    for i in range(0, 201):
        x = cx - r + (2 * r) * i / 200
        y = base + amp * math.sin((i / 200) * 2 * math.pi * 1.5)
        pontos.append((x, y))
    pontos += [(cx + r, cy + r), (cx - r, cy + r)]
    od.polygon(pontos, fill=255)
    mascara = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mascara).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    from PIL import ImageChops
    onda = ImageChops.multiply(onda, mascara)
    img.paste(Image.new("RGBA", (s, s), ROSE_ESCURO), (0, 0), onda)

    # "M" serifado vinho, centralizado um pouco acima do centro
    altura_m = r * 0.92
    fonte = achar_fonte(int(altura_m * 1.35))
    if fonte is not None:
        caixa = d.textbbox((0, 0), "M", font=fonte)
        lw, lh = caixa[2] - caixa[0], caixa[3] - caixa[1]
        # ajusta para a altura desejada
        fator = altura_m / lh
        fonte = achar_fonte(max(8, int(altura_m * 1.35 * fator)))
        caixa = d.textbbox((0, 0), "M", font=fonte)
        lw, lh = caixa[2] - caixa[0], caixa[3] - caixa[1]
        x = cx - lw / 2 - caixa[0]
        y = cy - lh / 2 - caixa[1] - r * 0.06
        d.text((x, y), "M", font=fonte, fill=VINHO)
    else:
        desenhar_m_poligonos(d, cx, cy - r * 0.06, altura_m, VINHO)

    return img.resize((tamanho_final, tamanho_final), Image.LANCZOS)


def main():
    os.makedirs(SAIDA, exist_ok=True)
    alvos = {
        "icon-512.png": 512,
        "icon-192.png": 192,
        "apple-touch-icon.png": 180,
        "favicon.png": 32,
    }
    usou_fonte = achar_fonte(64) is not None
    for nome, tamanho in alvos.items():
        img = desenhar(tamanho)
        if nome == "apple-touch-icon.png":
            img = img.convert("RGB")  # iOS ignora transparência; fundo já é vinho
        img.save(os.path.join(SAIDA, nome), optimize=True)
        print(f"icons/{nome} ({tamanho}x{tamanho})")
    print("M com fonte serifada" if usou_fonte else "M desenhado com polígonos (nenhuma fonte serifada encontrada)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
