#!/usr/bin/env python3
"""
Console script to add/update an environment variable permanently in ~/.bashrc.
Prompts for variable name and value via stdin, then writes export line.
"""
import os
import sys

CONFIG_FILE = os.path.expanduser("~/.bashrc")
EXPORT_TEMPLATE = 'export {}="{}"'

def main():
    try:
        var_name = input("Nome della variabile d'ambiente (es. OPENROUTER_API_KEY): ").strip()
    except EOFError:
        print("\nInput interrotto.")
        sys.exit(1)
    if not var_name:
        print("Nome della variabile non può essere vuoto.")
        sys.exit(1)
    try:
        var_value = input(f"Valore per {var_name}: ")
    except EOFError:
        print("\nInput interrotto.")
        sys.exit(1)
    line = EXPORT_TEMPLATE.format(var_name, var_value)
    # Read existing lines
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
    else:
        lines = []
    # Remove any previous export line for this variable
    new_lines = [ln for ln in lines if not ln.strip().startswith(f"export {var_name}=")]
    # Append new line
    new_lines.append(line + "\n")
    # Write back
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
        print(f"Variabile {var_name} aggiunta/aggiornata in {CONFIG_FILE}.")
        print("Esegui 'source ~/.bashrc' o apri un nuovo terminale per applicare le modifiche.")
    except Exception as e:
        print(f"Errore scrivendo in {CONFIG_FILE}: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()