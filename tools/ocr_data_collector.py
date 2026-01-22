"""
OOTP Rating/Stat Data Collector
Screen OCR tool for collecting rating -> stat data points

Requirements:
    pip install pillow pytesseract mss keyboard

Also requires Tesseract OCR installed:
    Download from: https://github.com/UB-Mannheim/tesseract/wiki
    Default install path: C:\Program Files\Tesseract-OCR\tesseract.exe
"""

# Fix Windows DPI scaling BEFORE importing tkinter
import ctypes
try:
    # Windows 8.1+ per-monitor DPI awareness
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        # Fallback for older Windows
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
import csv
import json
import os
from datetime import datetime
from PIL import Image, ImageTk, ImageGrab
import pytesseract
import mss
import threading
import keyboard

# Configure Tesseract path for Windows
TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if os.path.exists(TESSERACT_PATH):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH


class Region:
    """Represents a screen region to monitor"""
    def __init__(self, name, x, y, width, height):
        self.name = name
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.last_value = ""

    def to_dict(self):
        return {
            "name": self.name,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height
        }

    def capture(self):
        """Capture and OCR this region"""
        with mss.mss() as sct:
            monitor = {
                "left": self.x,
                "top": self.y,
                "width": self.width,
                "height": self.height
            }
            screenshot = sct.grab(monitor)
            img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")

            # OCR with numeric optimization (including decimal points)
            text = pytesseract.image_to_string(
                img,
                config='--psm 7 -c tessedit_char_whitelist=0123456789.'
            ).strip()

            # Clean up common OCR issues
            text = text.replace(' ', '').replace('\n', '')

            self.last_value = text
            return text, img


class RegionSelector(tk.Toplevel):
    """Fullscreen overlay for selecting a screen region"""
    def __init__(self, parent, callback):
        super().__init__(parent)
        self.callback = callback
        self.start_x = None
        self.start_y = None
        self.rect = None

        # Get actual screen dimensions using ctypes (DPI-aware)
        user32 = ctypes.windll.user32
        self.screen_width = user32.GetSystemMetrics(0)
        self.screen_height = user32.GetSystemMetrics(1)

        # Position and size the overlay manually instead of using fullscreen
        self.overrideredirect(True)  # Remove window decorations
        self.geometry(f"{self.screen_width}x{self.screen_height}+0+0")
        self.attributes('-alpha', 0.3)
        self.attributes('-topmost', True)
        self.configure(bg='gray')

        # Canvas for drawing selection rectangle
        self.canvas = tk.Canvas(
            self,
            cursor="cross",
            bg='gray',
            highlightthickness=0,
            width=self.screen_width,
            height=self.screen_height
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)

        # Bind mouse events
        self.canvas.bind('<Button-1>', self.on_press)
        self.canvas.bind('<B1-Motion>', self.on_drag)
        self.canvas.bind('<ButtonRelease-1>', self.on_release)
        self.bind('<Escape>', lambda e: self.destroy())

        # Instructions
        self.canvas.create_text(
            self.screen_width // 2, 50,
            text="Click and drag to select a region. Press ESC to cancel.",
            fill='white', font=('Arial', 16, 'bold')
        )

        # Force focus
        self.focus_force()
        self.lift()

    def on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        if self.rect:
            self.canvas.delete(self.rect)
        self.rect = self.canvas.create_rectangle(
            self.start_x, self.start_y, self.start_x, self.start_y,
            outline='red', width=2
        )

    def on_drag(self, event):
        if self.rect:
            self.canvas.coords(self.rect, self.start_x, self.start_y, event.x, event.y)

    def on_release(self, event):
        x1, y1 = min(self.start_x, event.x), min(self.start_y, event.y)
        x2, y2 = max(self.start_x, event.x), max(self.start_y, event.y)
        width, height = x2 - x1, y2 - y1

        if width > 10 and height > 10:  # Minimum size check
            self.destroy()
            self.callback(x1, y1, width, height)
        else:
            messagebox.showwarning("Too Small", "Region too small. Try again.")
            self.destroy()


class DataCollectorApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("OOTP Rating/Stat Data Collector")
        self.root.geometry("800x600")
        self.root.minsize(700, 500)

        self.regions = []
        self.csv_file = None
        self.preview_images = {}

        self.setup_ui()
        self.setup_hotkey()

    def setup_ui(self):
        # Main container
        main_frame = ttk.Frame(self.root, padding=10)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # Top controls
        control_frame = ttk.Frame(main_frame)
        control_frame.pack(fill=tk.X, pady=(0, 10))

        ttk.Button(control_frame, text="Add Region", command=self.add_region).pack(side=tk.LEFT, padx=5)
        ttk.Button(control_frame, text="Remove Selected", command=self.remove_region).pack(side=tk.LEFT, padx=5)
        ttk.Button(control_frame, text="Clear All", command=self.clear_regions).pack(side=tk.LEFT, padx=5)

        ttk.Separator(control_frame, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=10)

        ttk.Button(control_frame, text="Save Regions", command=self.save_regions).pack(side=tk.LEFT, padx=5)
        ttk.Button(control_frame, text="Load Regions", command=self.load_regions).pack(side=tk.LEFT, padx=5)

        ttk.Separator(control_frame, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=10)

        ttk.Button(control_frame, text="Set CSV File", command=self.set_csv_file).pack(side=tk.LEFT, padx=5)
        self.csv_label = ttk.Label(control_frame, text="No file selected", foreground="gray")
        self.csv_label.pack(side=tk.LEFT, padx=5)

        # Paned window for regions list and preview
        paned = ttk.PanedWindow(main_frame, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True, pady=10)

        # Left side - regions list
        left_frame = ttk.LabelFrame(paned, text="Regions", padding=5)
        paned.add(left_frame, weight=1)

        # Treeview for regions
        columns = ('name', 'x', 'y', 'width', 'height', 'value')
        self.tree = ttk.Treeview(left_frame, columns=columns, show='headings', height=10)

        self.tree.heading('name', text='Name')
        self.tree.heading('x', text='X')
        self.tree.heading('y', text='Y')
        self.tree.heading('width', text='W')
        self.tree.heading('height', text='H')
        self.tree.heading('value', text='OCR Value')

        self.tree.column('name', width=120)
        self.tree.column('x', width=50)
        self.tree.column('y', width=50)
        self.tree.column('width', width=50)
        self.tree.column('height', width=50)
        self.tree.column('value', width=80)

        scrollbar = ttk.Scrollbar(left_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.tree.bind('<<TreeviewSelect>>', self.on_region_select)

        # Right side - preview
        right_frame = ttk.LabelFrame(paned, text="Preview", padding=5)
        paned.add(right_frame, weight=1)

        self.preview_label = ttk.Label(right_frame, text="Select a region to preview")
        self.preview_label.pack(expand=True)

        self.preview_canvas = tk.Canvas(right_frame, bg='white', width=200, height=100)
        self.preview_canvas.pack(pady=10)

        # Bottom - log controls
        bottom_frame = ttk.Frame(main_frame)
        bottom_frame.pack(fill=tk.X, pady=10)

        self.log_btn = ttk.Button(
            bottom_frame,
            text="📝 LOG DATA ENTRY (F5)",
            command=self.log_entry,
            style='Accent.TButton'
        )
        self.log_btn.pack(pady=5)

        ttk.Button(bottom_frame, text="🔄 Refresh All OCR", command=self.refresh_all_ocr).pack(pady=5)

        # Status bar
        self.status_var = tk.StringVar(value="Ready. Press F5 or click 'Log Data Entry' to capture.")
        status_bar = ttk.Label(main_frame, textvariable=self.status_var, relief=tk.SUNKEN, anchor=tk.W)
        status_bar.pack(fill=tk.X, side=tk.BOTTOM)

        # Entry counter
        self.entry_count = 0
        self.count_label = ttk.Label(bottom_frame, text="Entries logged: 0")
        self.count_label.pack()

    def setup_hotkey(self):
        """Setup F5 as global hotkey for logging"""
        def on_f5():
            self.root.after(0, self.log_entry)

        keyboard.add_hotkey('F5', on_f5)
        self.status_var.set("Ready. Press F5 (global hotkey) or click button to log entry.")

    def add_region(self):
        """Open region selector overlay"""
        self.root.withdraw()  # Hide main window
        self.root.after(200, self._start_selection)

    def _start_selection(self):
        selector = RegionSelector(self.root, self._on_region_selected)
        selector.wait_window()
        self.root.deiconify()

    def _on_region_selected(self, x, y, width, height):
        """Called when user finishes selecting a region"""
        self.root.deiconify()

        # Ask for region name
        name = simpledialog.askstring(
            "Region Name",
            "Enter a name for this region (e.g., 'Stuff Rating', 'ERA Stat'):",
            parent=self.root
        )

        if name:
            region = Region(name, x, y, width, height)
            self.regions.append(region)

            # Initial OCR
            value, img = region.capture()

            # Add to tree
            self.tree.insert('', tk.END, values=(name, x, y, width, height, value))

            self.status_var.set(f"Added region: {name}")

    def remove_region(self):
        """Remove selected region"""
        selection = self.tree.selection()
        if selection:
            idx = self.tree.index(selection[0])
            self.tree.delete(selection[0])
            del self.regions[idx]

    def clear_regions(self):
        """Clear all regions"""
        if messagebox.askyesno("Confirm", "Clear all regions?"):
            self.tree.delete(*self.tree.get_children())
            self.regions.clear()

    def save_regions(self):
        """Save regions to a JSON file"""
        if not self.regions:
            messagebox.showwarning("No Regions", "No regions to save!")
            return

        from tkinter import filedialog
        filepath = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON files", "*.json")],
            initialfile="regions_pitcher.json"
        )
        if filepath:
            data = [r.to_dict() for r in self.regions]
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=2)
            self.status_var.set(f"Regions saved to {os.path.basename(filepath)}")

    def load_regions(self):
        """Load regions from a JSON file"""
        from tkinter import filedialog
        filepath = filedialog.askopenfilename(
            filetypes=[("JSON files", "*.json")]
        )
        if filepath:
            with open(filepath, 'r') as f:
                data = json.load(f)

            # Clear existing
            self.tree.delete(*self.tree.get_children())
            self.regions.clear()

            # Load new regions
            for item in data:
                region = Region(
                    item['name'],
                    item['x'],
                    item['y'],
                    item['width'],
                    item['height']
                )
                self.regions.append(region)

                # Initial OCR
                value, _ = region.capture()

                # Add to tree
                self.tree.insert('', tk.END, values=(
                    region.name, region.x, region.y,
                    region.width, region.height, value
                ))

            self.status_var.set(f"Loaded {len(self.regions)} regions from {os.path.basename(filepath)}")

    def on_region_select(self, event):
        """Show preview of selected region"""
        selection = self.tree.selection()
        if selection:
            idx = self.tree.index(selection[0])
            region = self.regions[idx]

            # Capture and show preview
            value, img = region.capture()

            # Resize for preview
            img.thumbnail((300, 150))
            photo = ImageTk.PhotoImage(img)

            self.preview_canvas.delete("all")
            self.preview_canvas.config(width=img.width, height=img.height)
            self.preview_canvas.create_image(0, 0, anchor=tk.NW, image=photo)
            self.preview_canvas.image = photo  # Keep reference

            self.preview_label.config(text=f"OCR Value: {value}")

            # Update tree value
            self.tree.item(selection[0], values=(
                region.name, region.x, region.y, region.width, region.height, value
            ))

    def refresh_all_ocr(self):
        """Refresh OCR for all regions"""
        for i, region in enumerate(self.regions):
            value, _ = region.capture()
            item = self.tree.get_children()[i]
            self.tree.item(item, values=(
                region.name, region.x, region.y, region.width, region.height, value
            ))
        self.status_var.set("All regions refreshed")

    def set_csv_file(self):
        """Set the output CSV file"""
        from tkinter import filedialog
        filepath = filedialog.asksaveasfilename(
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv")],
            initialfile=f"ootp_data_{datetime.now().strftime('%Y%m%d')}.csv"
        )
        if filepath:
            self.csv_file = filepath
            self.csv_label.config(text=os.path.basename(filepath), foreground="green")

            # Create file with headers if new
            if not os.path.exists(filepath):
                with open(filepath, 'w', newline='') as f:
                    writer = csv.writer(f)
                    headers = [r.name for r in self.regions]
                    writer.writerow(headers)

            self.status_var.set(f"CSV file set: {filepath}")

    def log_entry(self):
        """Log current OCR values to CSV"""
        if not self.regions:
            messagebox.showwarning("No Regions", "Add some regions first!")
            return

        if not self.csv_file:
            self.set_csv_file()
            if not self.csv_file:
                return

        # Capture all regions
        values = []
        for i, region in enumerate(self.regions):
            value, _ = region.capture()
            values.append(value)

            # Update tree
            item = self.tree.get_children()[i]
            self.tree.item(item, values=(
                region.name, region.x, region.y, region.width, region.height, value
            ))

        # Check if headers need updating (new regions added)
        self._update_csv_headers()

        # Write to CSV
        with open(self.csv_file, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(values)

        self.entry_count += 1
        self.count_label.config(text=f"Entries logged: {self.entry_count}")
        self.status_var.set(f"✓ Entry #{self.entry_count} logged: {values}")

        # Visual feedback
        self.root.bell()

    def _update_csv_headers(self):
        """Update CSV headers if regions changed"""
        if not os.path.exists(self.csv_file):
            return

        # Read existing data
        with open(self.csv_file, 'r', newline='') as f:
            reader = csv.reader(f)
            rows = list(reader)

        if not rows:
            return

        current_headers = [r.name for r in self.regions]

        # If headers changed, rewrite with new headers
        if rows[0] != current_headers:
            rows[0] = current_headers
            with open(self.csv_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerows(rows)

    def run(self):
        self.root.mainloop()
        keyboard.unhook_all()


def check_dependencies():
    """Check if required dependencies are installed"""
    missing = []

    try:
        import PIL
    except ImportError:
        missing.append("pillow")

    try:
        import pytesseract
    except ImportError:
        missing.append("pytesseract")

    try:
        import mss
    except ImportError:
        missing.append("mss")

    try:
        import keyboard
    except ImportError:
        missing.append("keyboard")

    if missing:
        print("Missing dependencies. Install with:")
        print(f"  pip install {' '.join(missing)}")
        return False

    # Check Tesseract installation
    if not os.path.exists(TESSERACT_PATH):
        print(f"Tesseract OCR not found at: {TESSERACT_PATH}")
        print("Download from: https://github.com/UB-Mannheim/tesseract/wiki")
        print("Or update TESSERACT_PATH in this script if installed elsewhere.")
        return False

    return True


if __name__ == "__main__":
    if check_dependencies():
        app = DataCollectorApp()
        app.run()
    else:
        input("\nPress Enter to exit...")
