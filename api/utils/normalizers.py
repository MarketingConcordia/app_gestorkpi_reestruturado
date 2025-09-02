from datetime import date, datetime
from rest_framework import serializers


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
    Normaliza número aceitando formatos como:
      - "100", "100,5", "100.5", "1.234,56", "1,234.56"
    Regra: o ÚLTIMO separador (',' ou '.') é o decimal; os demais são milhares.
    Retorna float.
    """
    if value in (None, ''):
        return None

    s = str(value).strip().replace(' ', '')
    last_comma = s.rfind(',')
    last_dot = s.rfind('.')
    dec_pos = max(last_comma, last_dot)

    digits = ''.join(ch for ch in s if ch.isdigit())

    if dec_pos == -1:
        try:
            return float(digits)
        except Exception:
            raise serializers.ValidationError(f"{field_name} deve ser numérico.")

    after = ''.join(ch for ch in s[dec_pos + 1:] if ch.isdigit())

    if after == '':
        try:
            return float(digits)
        except Exception:
            raise serializers.ValidationError(f"{field_name} deve ser numérico.")

    int_len = len(digits) - len(after)
    if int_len <= 0:
        num_str = "0." + digits.zfill(len(after))
    else:
        num_str = digits[:int_len] + "." + digits[int_len:]

    try:
        return float(num_str)
    except Exception:
        raise serializers.ValidationError(f"{field_name} deve ser numérico.")
