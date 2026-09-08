#!/usr/bin/env python3
"""
Script Tkinter per aggiungere/esportare definitivamente una variabile d'ambiente
nel file di avvio della shell (bash: ~/.bashrc).
Chiede:
  - Nome della variabile
  - Valore da assegnare
Aggiunge (o aggiorna) la linea:
    export NOME_VARIABILE="valore"
alla fine di ~/.bashrc, evitando duplicati.
"""

import tkinter as tk
from tkinter import simpledialog, messagebox
import os
import sys

CONFIG_FILE = os.path.expanduser("~/.bashrc")
EXPORT_TEMPLATE = 'export {}="{}"'

def ask_inputs():
    root = tk.Tk()
    root.withdraw()  # nascondi la finestra principale

    var_name = simpledialog.askstring("Nome variabile", "Inserisci il nome della variabile d'ambiente (es. OPENROUTER_API_KEY):")
    if var_name is None:
        return None, None  # annullato
    var_name = var_name.strip()
    if not var_name:
        messagebox.showerror("Errore", "Il nome della variabile non può essere vuoto.")
        return ask_inputs()

    var_value = simpledialog.askstring("Valore", f"Inserisci il valore per {var_name}:")
    if var_value is None:
        return None, None  # annullato
    # il valore può essere vuoto, lo accettiamo così com'è
    return var_name, var_value

def update_bashrc(var_name, var_value):
    line = EXPORT_TEMPLATE.format(var_name, var_value)
    try:
        # leggere il file se esiste
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                lines = f.readlines()
        else:
            lines = []

        # rimuovi eventuali linee precedenti con lo stesso export (per evitare duplicati)
        new_lines = []
        for ln in lines:
            stripped = ln.strip()
            # riconosci linee del tipo export NOME="valore" o export NOME=valore
            if stripped.startswith(f"export {var_name}="):
                # salta questa linea (la sostituiremo con la nuova)
                continue
            new_lines.append(ln)

        # aggiungi la nuova linea alla fine
        new_lines.append(line + "\n")

        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            f.writelines(new_lines)

        messagebox.showinfo("Successo", f"Variabile {var_name} aggiunta/aggiornata in {CONFIG_FILE}.\n"
                                          "Ricorda di eseguire 'source ~/.bashrc' o aprire un nuovo terminale.")
    except Exception as e:
        messagebox.showerror("Errore", f"Impossibile scrivere in {CONFIG_FILE}:\n{e}")

def main():
    var_name, var_value = ask_inputs()
    if var_name is None:
        sys.exit(0)  # annullato dall'utente
    update_bashrc(var_name, var_value)

if __name__ == "__main__":
    main()