from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import date, datetime
from rest_framework import serializers
import re


def parse_mes_inicial(v):
    """
    Aceita:
      - None / '' → None
      - date
      - 'YYYY-MM' → primeiro dia do mês
      - 'YYYY-MM-DD' → normaliza para primeiro dia do mês
    """
    if v in (None, ''):
        return None
    if isinstance(v, date):
        return date(v.year, v.month, 1)
    if isinstance(v, str):
        s = v.strip()
        if len(s) == 7 and s.count('-') == 1:  # 'YYYY-MM'
            year = int(s[:4])
            month = int(s[5:7])
            return date(year, month, 1)
        if len(s) == 10 and s.count('-') == 2:  # 'YYYY-MM-DD'
            dt = datetime.strptime(s, '%Y-%m-%d').date()
            return date(dt.year, dt.month, 1)
    return v


def normalize_number(value, field_name="valor"):
    """
    Normaliza número aceitando pt-BR e en-US e PRESERVANDO o sinal negativo.

    Exemplos aceitos:
      - "-1.234,56" -> -1234.56
      - "-1234.56"  -> -1234.56
      - "−1.234,56" (menos unicode) -> -1234.56
      - "(1.234,56)" (notação contábil) -> -1234.56
      - "R$ -1.234,56" -> -1234.56

    Retorna float (mantém compatibilidade com o uso atual no serializer).
    """
    if value in (None, ""):
        return None

    # Se já for numérico, apenas converte para float
    if isinstance(value, (int, float)):
        return float(value)

    s = str(value).strip()
    if not s:
        return None

    # Notação contábil: (123,45) => -123,45
    neg_parenteses = s.startswith("(") and s.endswith(")")
    if neg_parenteses:
        s = s[1:-1].strip()

    # Normaliza espaços e símbolos comuns de moeda
    s = s.replace("R$", "").replace(" ", "")

    # Normaliza sinal unicode "−" (U+2212) para '-'
    s = s.replace("\u2212", "-")

    # Captura sinal SOMENTE se estiver no início
    is_negative = s.startswith("-")
    if is_negative:
        s = s[1:]

    # Mantém apenas dígitos, vírgula e ponto
    s = "".join(ch for ch in s if ch.isdigit() or ch in ",.")

    # Determina o separador decimal:
    # Se houver vírgula e ponto, a ÚLTIMA ocorrência decide o decimal
    has_comma = "," in s
    has_dot = "." in s
    if has_comma and has_dot:
        last_comma = s.rfind(",")
        last_dot = s.rfind(".")
        if last_comma > last_dot:
            # vírgula é decimal: remove pontos de milhar e troca vírgula por ponto
            s = s.replace(".", "")
            s = s.replace(",", ".")
        else:
            # ponto é decimal: remove vírgulas de milhar
            s = s.replace(",", "")
    elif has_comma:
        # só vírgula -> decimal
        s = s.replace(".", "")  # ponto vira milhar
        s = s.replace(",", ".")
    else:
        # só ponto ou nenhum -> mantém
        pass

    # Garante que só exista um ponto decimal
    parts = s.split(".")
    if len(parts) > 1:
        int_part = "".join(parts[:-1])
        frac_part = parts[-1]
        s = f"{int_part}.{frac_part}"

    # Validação final: precisa ter dígitos
    if not s or not re.fullmatch(r"\d+(\.\d+)?", s):
        # tenta remover lixo residual
        s = re.sub(r"[^0-9.]", "", s)
    if not s or not re.fullmatch(r"\d+(\.\d+)?", s):
        raise serializers.ValidationError(f"{field_name} deve ser numérico.")

    try:
        d = Decimal(s)  # NUNCA use float aqui
    except InvalidOperation:
        raise serializers.ValidationError(f"{field_name} deve ser numérico.")

    if is_negative or neg_parenteses:
        d = -d

    # quantiza para 2 casas por padrão (padrão do projeto)
    q = Decimal('0.01')
    d = d.quantize(q, rounding=ROUND_HALF_UP)
    return d
