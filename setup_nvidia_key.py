import ctypes
import os
import tkinter as tk
from tkinter import messagebox, ttk
import winreg

ENVIRONMENT_KEY = r"Environment"
VARIABLE_NAME = "NVIDIA_API_KEY"


def broadcast_environment_change():
    """Tell already-running Windows applications that user variables changed."""
    HWND_BROADCAST = 0xFFFF
    WM_SETTINGCHANGE = 0x001A
    SMTO_ABORTIFHUNG = 0x0002
    ctypes.windll.user32.SendMessageTimeoutW(
        HWND_BROADCAST,
        WM_SETTINGCHANGE,
        0,
        "Environment",
        SMTO_ABORTIFHUNG,
        5000,
        ctypes.byref(ctypes.c_ulong()),
    )


def save_key():
    value = key_var.get().strip()
    if not value:
        messagebox.showwarning("Chiave mancante", "Inserisci una chiave NVIDIA API.")
        key_entry.focus_set()
        return
    if not value.startswith("nvapi-"):
        proceed = messagebox.askyesno(
            "Formato inatteso",
            "La chiave non inizia con 'nvapi-'. Vuoi salvarla comunque?",
        )
        if not proceed:
            return

    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            ENVIRONMENT_KEY,
            0,
            winreg.KEY_SET_VALUE,
        ) as environment:
            winreg.SetValueEx(environment, VARIABLE_NAME, 0, winreg.REG_SZ, value)

        # Make it available to this utility process too, without printing it.
        os.environ[VARIABLE_NAME] = value
        key_var.set("")
        status_var.set("Chiave salvata nell’ambiente utente di Windows.")
        messagebox.showinfo(
            "Configurazione completata",
            "La chiave NVIDIA è stata salvata.\n\n"
            "Chiudi e riapri PowerShell/Prompt dei comandi, poi avvia l’app con:\n"
            "node server.mjs",
        )
        broadcast_environment_change()
    except PermissionError:
        messagebox.showerror(
            "Permesso negato",
            "Windows non ha consentito la modifica dell’ambiente utente.",
        )
    except OSError as error:
        messagebox.showerror("Errore", f"Impossibile salvare la chiave: {error}")


def clear_key():
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            ENVIRONMENT_KEY,
            0,
            winreg.KEY_SET_VALUE,
        ) as environment:
            winreg.DeleteValue(environment, VARIABLE_NAME)
        os.environ.pop(VARIABLE_NAME, None)
        status_var.set("Chiave rimossa dall’ambiente utente.")
        broadcast_environment_change()
        messagebox.showinfo("Chiave rimossa", "NVIDIA_API_KEY è stata rimossa.")
    except FileNotFoundError:
        status_var.set("Nessuna chiave NVIDIA configurata.")
    except OSError as error:
        messagebox.showerror("Errore", f"Impossibile rimuovere la chiave: {error}")


def toggle_visibility():
    key_entry.configure(show="" if show_var.get() else "•")


root = tk.Tk()
root.title("Configurazione NVIDIA API")
root.geometry("520x285")
root.resizable(False, False)
root.configure(bg="#f6f3ee")

style = ttk.Style(root)
style.theme_use("clam")
style.configure("Card.TFrame", background="#fffdf9")
style.configure("Title.TLabel", background="#fffdf9", foreground="#17344a", font=("Segoe UI", 18, "bold"))
style.configure("Body.TLabel", background="#fffdf9", foreground="#526872", font=("Segoe UI", 10))
style.configure("Status.TLabel", background="#fffdf9", foreground="#628270", font=("Segoe UI", 9))
style.configure("Primary.TButton", background="#17344a", foreground="white", padding=(14, 8), font=("Segoe UI", 10, "bold"))
style.configure("Secondary.TButton", background="#eeeae3", foreground="#17344a", padding=(12, 8), font=("Segoe UI", 9))

outer = ttk.Frame(root, padding=18, style="Card.TFrame")
outer.pack(fill="both", expand=True, padx=18, pady=18)

ttk.Label(outer, text="Collega NVIDIA alla tua app", style="Title.TLabel").pack(anchor="w")
ttk.Label(
    outer,
    text="Inserisci la chiave API. Verrà salvata solo nell’ambiente utente di Windows, non nel progetto.",
    style="Body.TLabel",
    wraplength=450,
).pack(anchor="w", pady=(8, 18))

ttk.Label(outer, text="NVIDIA_API_KEY", style="Body.TLabel").pack(anchor="w")
key_var = tk.StringVar()
key_entry = ttk.Entry(outer, textvariable=key_var, show="•", width=60)
key_entry.pack(fill="x", pady=(5, 8))
key_entry.focus_set()

show_var = tk.BooleanVar(value=False)
ttk.Checkbutton(
    outer,
    text="Mostra chiave",
    variable=show_var,
    command=toggle_visibility,
    style="Body.TLabel",
).pack(anchor="w")

buttons = ttk.Frame(outer, style="Card.TFrame")
buttons.pack(fill="x", pady=(18, 8))
ttk.Button(buttons, text="Salva chiave", command=save_key, style="Primary.TButton").pack(side="left")
ttk.Button(buttons, text="Rimuovi chiave", command=clear_key, style="Secondary.TButton").pack(side="left", padx=(10, 0))
ttk.Button(buttons, text="Chiudi", command=root.destroy, style="Secondary.TButton").pack(side="right")

status_var = tk.StringVar(value="La chiave non verrà mostrata o registrata nei log.")
ttk.Label(outer, textvariable=status_var, style="Status.TLabel", wraplength=450).pack(anchor="w", pady=(8, 0))

root.bind("<Return>", lambda _event: save_key())
root.mainloop()
