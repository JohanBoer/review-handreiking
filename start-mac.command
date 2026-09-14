#!/bin/bash
# Dubbelklikbare starter voor macOS: controleert Node.js, start de server en opent de browser.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is niet gevonden op dit systeem."
  if command -v brew >/dev/null 2>&1; then
    read -p "Node.js installeren via Homebrew? (j/n) " ans
    if [[ "$ans" == "j" || "$ans" == "J" ]]; then
      brew install node
    else
      echo "Installeer Node.js handmatig (LTS-versie) via https://nodejs.org en start dit script daarna opnieuw."
      open "https://nodejs.org/" 2>/dev/null
      read -p "Druk op Enter om dit venster te sluiten..."
      exit 1
    fi
  else
    echo "Installeer Node.js handmatig (LTS-versie) via https://nodejs.org en start dit script daarna opnieuw."
    open "https://nodejs.org/" 2>/dev/null
    read -p "Druk op Enter om dit venster te sluiten..."
    exit 1
  fi
fi

echo ""
echo "Review-tool wordt gestart..."
echo "(Laat dit venster open zolang je de tool gebruikt. Sluiten of Ctrl+C stopt de server.)"
echo ""

( sleep 1.5 && open "http://localhost:3000/setup" ) &
node server.js

read -p "Druk op Enter om dit venster te sluiten..."
