#!/usr/bin/env bash
# Ersteinrichtung von spur: fragt Adresse, Mail und Kontaktadresse ab, schreibt .env im
# aktuellen Ordner und startet spur wie `make start`. Aufruf über `make setup`.
# Nur für tools/tests/setup.test.mjs: SPUR_SETUP_TROCKEN=1 überspringt den Start,
# SPUR_SETUP_TEST_STDIN=1 überspringt die Terminal-Prüfung, damit der Test die Antworten per Pipe liefert.
set -eu

ENV_DATEI=.env

if [ ! -t 0 ] && [ "${SPUR_SETUP_TEST_STDIN:-}" != 1 ]; then
  echo "make setup stellt Fragen und braucht ein Terminal. Starte es direkt in einem Terminal, nicht in einer Pipe oder einem Skript." >&2
  echo "Ohne Fragen startet spur mit: make start" >&2
  exit 1
fi

umask 077

wert_lesen() {
  [ -f "$ENV_DATEI" ] || return 0
  grep "^$1=" "$ENV_DATEI" | tail -n 1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'\$//" || true
}

hat_wert() {
  [ -f "$ENV_DATEI" ] && grep -q "^$1=" "$ENV_DATEI"
}

entfernen() {
  hat_wert "$1" || return 0
  tmp=$(mktemp "$ENV_DATEI.XXXXXX")
  grep -v "^$1=" "$ENV_DATEI" > "$tmp" || true
  mv "$tmp" "$ENV_DATEI"
}

setzen() {
  case "$2" in
    *"'"*) echo "Der Wert für $1 enthält ein einfaches Anführungszeichen. Das kann .env nicht speichern." >&2; exit 1 ;;
    *[!A-Za-z0-9_@%+=:,./-]*) wert="'$2'" ;;
    *) wert=$2 ;;
  esac
  tmp=$(mktemp "$ENV_DATEI.XXXXXX")
  if [ -f "$ENV_DATEI" ]; then grep -v "^$1=" "$ENV_DATEI" > "$tmp" || true; fi
  printf '%s=%s\n' "$1" "$wert" >> "$tmp"
  mv "$tmp" "$ENV_DATEI"
}

frage() {
  if [ -n "$2" ]; then printf '%s [%s]: ' "$1" "$2"; else printf '%s: ' "$1"; fi
  read -r antwort || antwort=
  [ -n "$antwort" ] || antwort=$2
}

ja_nein() {
  while :; do
    printf '%s (j/n) [%s]: ' "$1" "$2"
    read -r a || a=
    [ -n "$a" ] || a=$2
    case $(printf '%s' "$a" | tr '[:upper:]' '[:lower:]') in
      j|ja|y|yes) return 0 ;;
      n|nein|no) return 1 ;;
    esac
  done
}

if ! hat_wert OVERLEAF_INVITE_TOKEN_SECRET; then
  setzen OVERLEAF_INVITE_TOKEN_SECRET "$(openssl rand -base64 32)"
  echo ".env mit neuem OVERLEAF_INVITE_TOKEN_SECRET angelegt."
fi

fragen=1
vorhanden=0
for k in SPUR_URL OVERLEAF_SECURE_COOKIE OVERLEAF_EMAIL_FROM_ADDRESS OVERLEAF_EMAIL_SMTP_HOST \
  OVERLEAF_EMAIL_SMTP_PORT OVERLEAF_EMAIL_SMTP_USER OVERLEAF_EMAIL_SMTP_PASS CROSSREF_MAILTO UNPAYWALL_EMAIL; do
  if hat_wert "$k"; then vorhanden=1; fi
done
if [ "$vorhanden" = 1 ] && ! ja_nein "In .env stehen schon Werte. Vorhandene Werte ändern?" n; then
  fragen=0
  echo "Vorhandene Werte bleiben unverändert."
fi

if [ "$fragen" = 1 ]; then
  while :; do
    frage "Adresse, unter der spur erreichbar ist" "$(wert_lesen SPUR_URL)"
    [ -n "$antwort" ] || antwort=http://localhost:8080
    antwort=${antwort%/}
    case $antwort in
      http://?*|https://?*) break ;;
    esac
    echo "Die Adresse muss mit http:// oder https:// beginnen."
  done
  setzen SPUR_URL "$antwort"
  case $antwort in
    https://*) setzen OVERLEAF_SECURE_COOKIE true ;;
    *) if [ "$(wert_lesen OVERLEAF_SECURE_COOKIE)" = true ]; then entfernen OVERLEAF_SECURE_COOKIE; fi ;;
  esac

  standard=n
  if hat_wert OVERLEAF_EMAIL_SMTP_HOST; then standard=j; fi
  if ja_nein "Mail einrichten? Ohne Mail gibst du Einladungslinks selbst weiter" "$standard"; then
    frage "Absenderadresse" "$(wert_lesen OVERLEAF_EMAIL_FROM_ADDRESS)"
    [ -z "$antwort" ] || setzen OVERLEAF_EMAIL_FROM_ADDRESS "$antwort"
    frage "SMTP-Host" "$(wert_lesen OVERLEAF_EMAIL_SMTP_HOST)"
    [ -z "$antwort" ] || setzen OVERLEAF_EMAIL_SMTP_HOST "$antwort"
    frage "SMTP-Port" "$(wert_lesen OVERLEAF_EMAIL_SMTP_PORT)"
    [ -z "$antwort" ] || setzen OVERLEAF_EMAIL_SMTP_PORT "$antwort"
    frage "SMTP-Nutzer" "$(wert_lesen OVERLEAF_EMAIL_SMTP_USER)"
    [ -z "$antwort" ] || setzen OVERLEAF_EMAIL_SMTP_USER "$antwort"
    if hat_wert OVERLEAF_EMAIL_SMTP_PASS; then
      printf 'SMTP-Passwort (leer lassen behält das vorhandene): '
    else
      printf 'SMTP-Passwort (bleibt unsichtbar): '
    fi
    read -r -s antwort || antwort=
    echo
    [ -z "$antwort" ] || setzen OVERLEAF_EMAIL_SMTP_PASS "$antwort"
  fi

  frage "Kontaktadresse für Crossref und Unpaywall (optional)" "$(wert_lesen CROSSREF_MAILTO)"
  if [ -n "$antwort" ]; then
    setzen CROSSREF_MAILTO "$antwort"
    setzen UNPAYWALL_EMAIL "$antwort"
  fi
  echo ".env gespeichert."
fi

if [ "${SPUR_SETUP_TROCKEN:-}" = 1 ]; then
  echo "Trockenlauf: spur wird nicht gestartet."
  exit 0
fi

exec "${MAKE:-make}" start
