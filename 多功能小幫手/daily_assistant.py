# -*- coding: utf-8 -*-
"""
Daily Wellness & Task Desktop Assistant (100% Pure Python / PyQt6)
包含三大頁籤：
1. 喝水提醒 & 打卡 (每小時提醒、預設 3000cc、一鍵重置喝水量、Apple 現代化數值輸入框 + 淺灰不可選取 cc、長條膠囊進度條)
2. 休息提醒 & 打卡 (預設 09:00 上班、Apple 現代化時間調整器、每工作 1 小時提醒休息 10 分鐘打卡循環)
3. 待辦事項 (分成低/中/高程度、支援選擇日期、打勾勾完成框、新增/修改/刪除與篩選)
"""

import calendar
import ctypes
import json
import math
import struct
import sys
import uuid
import wave
from datetime import datetime, date, timedelta
from io import BytesIO
from pathlib import Path

APP_VERSION = "1.0.0"

try:
    import winsound
except ImportError:
    winsound = None

from PyQt6.QtCore import (
    QEasingCurve,
    QByteArray,
    QDate,
    QPointF,
    QRectF,
    QSize,
    Qt,
    QTime,
    QTimer,
    QVariantAnimation,
    pyqtSignal,
)
from PyQt6.QtGui import (
    QAction,
    QColor,
    QFont,
    QIcon,
    QIntValidator,
    QPainter,
    QPainterPath,
    QPen,
    QPixmap,
)
from PyQt6.QtSvg import QSvgRenderer
from PyQt6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QComboBox,
    QDialog,
    QFrame,
    QGraphicsDropShadowEffect,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListView,
    QMainWindow,
    QMenu,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QStackedWidget,
    QSystemTrayIcon,
    QVBoxLayout,
    QWidget,
)


# ============================================================================
# 1. Apple 風格自繪 SVG 圖示模組 (SVG Icons)
# ============================================================================

class SvgIcons:
    """集中管理所有 Apple 風格自繪 SVG 向量圖示，並渲染為高解析度 QPixmap / QIcon。"""

    ASSISTANT_LOGO = """
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="56" height="56" rx="16" fill="#007AFF"/>
        <rect x="4" y="4" width="56" height="28" rx="16" fill="#5AC8FA" fill-opacity="0.28"/>
        <line x1="32" y1="11" x2="32" y2="18" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round"/>
        <circle cx="32" cy="10" r="3.6" fill="#FFD60A"/>
        <rect x="14" y="18" width="36" height="30" rx="12" fill="#FFFFFF"/>
        <rect x="9" y="27" width="5" height="12" rx="2.5" fill="#E5F1FF"/>
        <rect x="50" y="27" width="5" height="12" rx="2.5" fill="#E5F1FF"/>
        <rect x="19" y="23" width="26" height="16" rx="7" fill="#1D1D1F"/>
        <circle cx="26.5" cy="31" r="3.2" fill="#5AC8FA"/>
        <circle cx="37.5" cy="31" r="3.2" fill="#5AC8FA"/>
        <path d="M27.5 43C29 44.8 35 44.8 36.5 43" stroke="#007AFF" stroke-width="2.6" stroke-linecap="round"/>
    </svg>
    """

    WATER_DROP = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2.69L17.66 8.35C20.78 11.47 20.78 16.53 17.66 19.65C14.54 22.77 9.46 22.77 6.34 19.65C3.22 16.53 3.22 11.47 6.34 8.35L12 2.69Z"
              fill="{color}" fill-opacity="0.18" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8.5 14.5C8.5 16.43 10.07 18 12 18" stroke="{color}" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
    """

    COFFEE_BREAK = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 8H18C20.21 8 22 9.79 22 12C22 14.21 20.21 16 18 16H17" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M3 8H17V15C17 18.31 14.31 21 11 21H9C5.69 21 3 18.31 3 15V8Z" fill="{color}" fill-opacity="0.16" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 2V4M10 2V4M14 2V4" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
    </svg>
    """

    CHECKLIST = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="{color}" fill-opacity="0.15" stroke="{color}" stroke-width="2"/>
        <path d="M8 12.5L10.8 15.3L16.2 9.5" stroke="{color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    BELL = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 8C18 4.69 15.31 2 12 2C8.69 2 6 4.69 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z"
              fill="{color}" fill-opacity="0.16" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M13.73 21C13.38 21.6 12.74 22 12 22C11.26 22 10.62 21.6 10.27 21" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
    </svg>
    """

    SOUND_ON = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="{color}" fill-opacity="0.18" stroke="{color}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M15.54 8.46C16.48 9.4 17 10.67 17 12C17 13.33 16.48 14.6 15.54 15.54" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
        <path d="M19.07 4.93C20.95 6.81 22 9.35 22 12C22 14.65 20.95 17.19 19.07 19.07" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
    </svg>
    """

    SOUND_OFF = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="{color}" fill-opacity="0.15" stroke="{color}" stroke-width="2" stroke-linejoin="round"/>
        <line x1="22" y1="9" x2="16" y2="15" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="9" x2="22" y2="15" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
    </svg>
    """

    EDIT = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 20H21" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
        <path d="M16.5 3.5C17.33 2.67 18.67 2.67 19.5 3.5C20.33 4.33 20.33 5.67 19.5 6.5L7 19L3 20L4 16L16.5 3.5Z"
              stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    TRASH = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="3 6 5 6 21 6" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
        <path d="M19 6V20C19 21.1 18.1 22 17 22H7C5.9 22 5 21.1 5 20V6M8 6V4C8 2.9 8.9 2 10 2H14C15.1 2 16 2.9 16 4V6"
              stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    RESET = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 12C3 7.03 7.03 3 12 3C15.3 3 18.19 4.78 19.75 7.43" stroke="{color}" stroke-width="2.2" stroke-linecap="round"/>
        <polyline points="20 3 20 8 15 8" stroke="{color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M21 12C21 16.97 16.97 21 12 21C8.7 21 5.81 19.22 4.25 16.57" stroke="{color}" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
    """

    CALENDAR = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="4" width="18" height="17" rx="4" fill="{color}" fill-opacity="0.12" stroke="{color}" stroke-width="2"/>
        <line x1="16" y1="2" x2="16" y2="6" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
        <line x1="8" y1="2" x2="8" y2="6" stroke="{color}" stroke-width="2" stroke-linecap="round"/>
        <line x1="3" y1="10" x2="21" y2="10" stroke="{color}" stroke-width="2"/>
    </svg>
    """

    CHEVRON_UP = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="6 15 12 9 18 15" stroke="{color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    CHEVRON_DOWN = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="6 9 12 15 18 9" stroke="{color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    CHEVRON_LEFT = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="15 6 9 12 15 18" stroke="{color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    CHEVRON_RIGHT = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="9 6 15 12 9 18" stroke="{color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    DOUBLE_LEFT = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="11 17 6 12 11 7" stroke="{color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="18 17 13 12 18 7" stroke="{color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    DOUBLE_RIGHT = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="13 17 18 12 13 7" stroke="{color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="6 17 11 12 6 7" stroke="{color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """

    DOT = """
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="7" fill="{color}"/>
    </svg>
    """

    @staticmethod
    def pixmap(svg_template: str, color: str = "#007AFF", size: int = 22) -> QPixmap:
        svg_str = svg_template.format(color=color)
        renderer = QSvgRenderer(QByteArray(svg_str.encode("utf-8")))
        dpr = 2.0
        canvas_size = int(size * dpr)
        pix = QPixmap(canvas_size, canvas_size)
        pix.fill(Qt.GlobalColor.transparent)
        painter = QPainter(pix)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        renderer.render(painter, QRectF(0, 0, canvas_size, canvas_size))
        painter.end()
        pix.setDevicePixelRatio(dpr)
        return pix

    @classmethod
    def icon(cls, svg_template: str, color: str = "#007AFF", size: int = 22) -> QIcon:
        return QIcon(cls.pixmap(svg_template, color=color, size=size))


# ============================================================================
# 2. 本地儲存與跨日自動重置管理 (Storage Manager)
# ============================================================================

class StorageManager:
    """管理本機 app_data.json 讀寫，並在跨日打開時自動重置當日喝水與休息打卡紀錄。"""

    def __init__(self, file_path: Path | None = None):
        if file_path is None:
            if getattr(sys, "frozen", False):
                base_dir = Path(sys.executable).resolve().parent
            else:
                base_dir = Path(__file__).resolve().parent
            file_path = base_dir / "app_data.json"
        self.file_path = file_path
        self.data = self._load()
        self.check_daily_reset()

    def _default_data(self) -> dict:
        today_str = date.today().isoformat()
        return {
            "last_active_date": today_str,
            "sound_enabled": True,
            "water": {
                "goal_cc": 3000,
                "current_cc": 0,
                "logs": [],
            },
            "break_tracker": {
                "work_start_time": "09:00",
                "logs": [],
            },
            "todos": [
                {
                    "id": str(uuid.uuid4()),
                    "title": "準備好水杯，開始今天的 3000cc 喝水計畫",
                    "priority": "high",
                    "due_date": today_str,
                    "completed": False,
                    "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
                },
                {
                    "id": str(uuid.uuid4()),
                    "title": "整理今日工作重點事項",
                    "priority": "medium",
                    "due_date": today_str,
                    "completed": False,
                    "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
                },
                {
                    "id": str(uuid.uuid4()),
                    "title": "工作滿一小時起身伸展雙肩",
                    "priority": "low",
                    "due_date": today_str,
                    "completed": False,
                    "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
                },
            ],
        }

    def _load(self) -> dict:
        if not self.file_path.exists():
            default = self._default_data()
            self._write_disk(default)
            return default
        try:
            raw = json.loads(self.file_path.read_text(encoding="utf-8"))
            default = self._default_data()
            for key, val in default.items():
                if key not in raw:
                    raw[key] = val
            if "goal_cc" not in raw["water"] or raw["water"]["goal_cc"] <= 0:
                raw["water"]["goal_cc"] = 3000
            if "work_start_time" not in raw["break_tracker"] or not raw["break_tracker"]["work_start_time"]:
                raw["break_tracker"]["work_start_time"] = "09:00"
            today_str = date.today().isoformat()
            for todo in raw.get("todos", []):
                if "due_date" not in todo or not todo["due_date"]:
                    todo["due_date"] = today_str
            return raw
        except Exception:
            default = self._default_data()
            self._write_disk(default)
            return default

    def _write_disk(self, payload: dict) -> None:
        self.file_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=4),
            encoding="utf-8",
        )

    def save(self) -> None:
        self._write_disk(self.data)

    def check_daily_reset(self) -> bool:
        """若跨日則重置當日喝水量與休息打卡，保留目標水量、上班時間與待辦事項。"""
        today_str = date.today().isoformat()
        if self.data.get("last_active_date") != today_str:
            self.data["last_active_date"] = today_str
            self.data["water"]["current_cc"] = 0
            self.data["water"]["logs"] = []
            self.data["break_tracker"]["logs"] = []
            self.save()
            return True
        return False


# ============================================================================
# 3. 音效合成器 (無外部音檔依賴，純記憶體產生柔和雙音階 WAV 提示音)
# ============================================================================

class ChimePlayer:
    """使用標準庫產生柔和的 Apple 風雙音階鈴聲並透過 winsound 播放。"""

    _cached_wav: bytes | None = None

    @classmethod
    def _build_chime_wav(cls) -> bytes:
        if cls._cached_wav is not None:
            return cls._cached_wav
        sample_rate = 22050
        duration = 0.48
        total_samples = int(sample_rate * duration)
        buf = BytesIO()
        with wave.open(buf, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            frames = bytearray()
            for i in range(total_samples):
                t = i / sample_rate
                freq = 523.25 if t < 0.20 else 783.99
                local_t = t if t < 0.20 else (t - 0.20)
                envelope = math.exp(-local_t * 10.0) * min(1.0, local_t * 80.0)
                sample_val = int(12000 * envelope * math.sin(2.0 * math.pi * freq * t))
                frames.extend(struct.pack("<h", sample_val))
            wav_file.writeframes(bytes(frames))
        cls._cached_wav = buf.getvalue()
        return cls._cached_wav

    @classmethod
    def play(cls, enabled: bool = True) -> None:
        if not enabled or winsound is None:
            return
        try:
            wav_bytes = cls._build_chime_wav()
            winsound.PlaySound(
                wav_bytes,
                winsound.SND_MEMORY | winsound.SND_ASYNC | winsound.SND_NODEFAULT,
            )
        except Exception:
            pass


# ============================================================================
# 4. Apple 現代化自訂元件組 (無傳統 Windows 外框、不可選取 cc、打勾勾框、日曆)
# ============================================================================

class AppleNumberStepper(QFrame):
    """
    Apple 風格現代化數值輸入框：
    - 純數字輸入框 (點擊與全選只會選中數字，絕不會選到 cc)
    - 淺灰色不可選取的『cc』單位標籤
    - 右側現代化圓角扁平上下微調按鈕 (SVG 箭頭，告別傳統 Windows 95 立體方框)
    """

    valueChanged = pyqtSignal(int)

    def __init__(
        self,
        minimum: int = 100,
        maximum: int = 10000,
        step: int = 100,
        value: int = 3000,
        unit_text: str = "cc",
        height: int = 38,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._min = minimum
        self._max = maximum
        self._step = step
        self._value = max(minimum, min(maximum, value))

        self.setFixedHeight(height)
        self.setFixedWidth(168)
        self.setObjectName("AppleStepperFrame")
        self.setStyleSheet(
            """
            QFrame#AppleStepperFrame {
                background-color: #F5F5F7;
                border: 1.5px solid #E5E5EA;
                border-radius: 10px;
            }
            QFrame#AppleStepperFrame:hover {
                border-color: #C7C7CC;
            }
            """
        )

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 2, 4, 2)
        layout.setSpacing(4)

        # 純數字輸入框 (不含 cc)
        self.line_edit = QLineEdit(str(self._value))
        self.line_edit.setValidator(QIntValidator(self._min, self._max, self))
        self.line_edit.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.line_edit.setStyleSheet(
            """
            QLineEdit {
                background: transparent;
                border: none;
                font-size: 14px;
                font-weight: 700;
                color: #1D1D1F;
                padding: 0;
                selection-background-color: #007AFF;
                selection-color: #FFFFFF;
            }
            """
        )
        self.line_edit.editingFinished.connect(self._on_edit_finished)

        # 淺灰色、完全不可選取的單位標籤 ("cc")
        self.unit_label = QLabel(unit_text)
        self.unit_label.setTextInteractionFlags(Qt.TextInteractionFlag.NoTextInteraction)
        self.unit_label.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.unit_label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.unit_label.setStyleSheet(
            """
            QLabel {
                background: transparent;
                border: none;
                font-size: 13px;
                font-weight: 600;
                color: #8E8E93;
                padding-right: 4px;
            }
            """
        )

        # 現代化 Apple 風格上下微調按鈕組
        btn_col = QVBoxLayout()
        btn_col.setContentsMargins(0, 1, 0, 1)
        btn_col.setSpacing(2)

        btn_style = """
            QPushButton {
                background-color: #FFFFFF;
                border: 1px solid #E5E5EA;
                border-radius: 5px;
                padding: 0;
            }
            QPushButton:hover {
                background-color: #EBF4FF;
                border-color: #B3D7FF;
            }
            QPushButton:pressed {
                background-color: #D6E9FF;
            }
        """

        self.up_btn = QPushButton()
        self.up_btn.setFixedSize(26, int((height - 8) / 2))
        self.up_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.up_btn.setIcon(SvgIcons.icon(SvgIcons.CHEVRON_UP, "#3A3A3C", 12))
        self.up_btn.setIconSize(QSize(12, 12))
        self.up_btn.setStyleSheet(btn_style)
        self.up_btn.clicked.connect(lambda: self.stepBy(self._step))

        self.down_btn = QPushButton()
        self.down_btn.setFixedSize(26, int((height - 8) / 2))
        self.down_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.down_btn.setIcon(SvgIcons.icon(SvgIcons.CHEVRON_DOWN, "#3A3A3C", 12))
        self.down_btn.setIconSize(QSize(12, 12))
        self.down_btn.setStyleSheet(btn_style)
        self.down_btn.clicked.connect(lambda: self.stepBy(-self._step))

        btn_col.addWidget(self.up_btn)
        btn_col.addWidget(self.down_btn)

        layout.addWidget(self.line_edit, 1)
        layout.addWidget(self.unit_label)
        layout.addLayout(btn_col)

    def _on_edit_finished(self) -> None:
        text = self.line_edit.text().strip()
        try:
            val = int(text)
        except ValueError:
            val = self._value
        self.setValue(val)

    def stepBy(self, delta: int) -> None:
        self.setValue(self._value + delta)

    def value(self) -> int:
        return self._value

    def setValue(self, val: int) -> None:
        clamped = max(self._min, min(self._max, int(val)))
        changed = clamped != self._value
        self._value = clamped
        self.line_edit.setText(str(clamped))
        if changed:
            self.valueChanged.emit(clamped)


class AppleTimeStepper(QFrame):
    """
    Apple 風格現代化時間微調器 (取代古早的 QTimeEdit 立體上下按鈕)。
    """

    timeChanged = pyqtSignal(QTime)

    def __init__(self, initial_time: QTime | None = None, height: int = 38, parent: QWidget | None = None):
        super().__init__(parent)
        self._time = initial_time if (initial_time and initial_time.isValid()) else QTime(9, 0)

        self.setFixedHeight(height)
        self.setFixedWidth(136)
        self.setObjectName("AppleTimeFrame")
        self.setStyleSheet(
            """
            QFrame#AppleTimeFrame {
                background-color: #F5F5F7;
                border: 1.5px solid #E5E5EA;
                border-radius: 10px;
            }
            QFrame#AppleTimeFrame:hover {
                border-color: #C7C7CC;
            }
            """
        )

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 2, 4, 2)
        layout.setSpacing(6)

        self.time_edit = QLineEdit(self._time.toString("HH:mm"))
        self.time_edit.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.time_edit.setStyleSheet(
            """
            QLineEdit {
                background: transparent;
                border: none;
                font-size: 14px;
                font-weight: 700;
                color: #1D1D1F;
                padding: 0;
                selection-background-color: #007AFF;
                selection-color: #FFFFFF;
            }
            """
        )
        self.time_edit.editingFinished.connect(self._on_edit_finished)

        btn_col = QVBoxLayout()
        btn_col.setContentsMargins(0, 1, 0, 1)
        btn_col.setSpacing(2)

        btn_style = """
            QPushButton {
                background-color: #FFFFFF;
                border: 1px solid #E5E5EA;
                border-radius: 5px;
                padding: 0;
            }
            QPushButton:hover {
                background-color: #EBF4FF;
                border-color: #B3D7FF;
            }
            QPushButton:pressed {
                background-color: #D6E9FF;
            }
        """

        self.up_btn = QPushButton()
        self.up_btn.setFixedSize(26, int((height - 8) / 2))
        self.up_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.up_btn.setIcon(SvgIcons.icon(SvgIcons.CHEVRON_UP, "#3A3A3C", 12))
        self.up_btn.setIconSize(QSize(12, 12))
        self.up_btn.setStyleSheet(btn_style)
        self.up_btn.clicked.connect(lambda: self._add_minutes(15))

        self.down_btn = QPushButton()
        self.down_btn.setFixedSize(26, int((height - 8) / 2))
        self.down_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.down_btn.setIcon(SvgIcons.icon(SvgIcons.CHEVRON_DOWN, "#3A3A3C", 12))
        self.down_btn.setIconSize(QSize(12, 12))
        self.down_btn.setStyleSheet(btn_style)
        self.down_btn.clicked.connect(lambda: self._add_minutes(-15))

        btn_col.addWidget(self.up_btn)
        btn_col.addWidget(self.down_btn)

        layout.addWidget(self.time_edit, 1)
        layout.addLayout(btn_col)

    def _on_edit_finished(self) -> None:
        raw = self.time_edit.text().strip()
        parsed = QTime.fromString(raw, "HH:mm")
        if not parsed.isValid():
            parsed = QTime.fromString(raw, "H:mm")
        if parsed.isValid():
            self.setTime(parsed)
        else:
            self.time_edit.setText(self._time.toString("HH:mm"))

    def _add_minutes(self, mins: int) -> None:
        self.setTime(self._time.addSecs(mins * 60))

    def time(self) -> QTime:
        return self._time

    def setTime(self, new_time: QTime) -> None:
        if not new_time.isValid():
            return
        changed = new_time != self._time
        self._time = new_time
        self.time_edit.setText(self._time.toString("HH:mm"))
        if changed:
            self.timeChanged.emit(self._time)


class AppleCheckBox(QWidget):
    """
    自繪 Apple 風格圓角勾選框：
    - 未勾選時：純白底 + 柔和圓角灰框
    - 勾選完成時：翠綠底色 (#34C759) + 清晰白色『打勾勾 (✓)』向量線條
    """

    toggled = pyqtSignal(bool)

    def __init__(self, checked: bool = False, parent: QWidget | None = None):
        super().__init__(parent)
        self._checked = bool(checked)
        self._hovered = False
        self.setFixedSize(24, 24)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

    def isChecked(self) -> bool:
        return self._checked

    def setChecked(self, checked: bool) -> None:
        if self._checked != bool(checked):
            self._checked = bool(checked)
            self.update()

    def enterEvent(self, event) -> None:
        self._hovered = True
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        self._hovered = False
        self.update()
        super().leaveEvent(event)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._checked = not self._checked
            self.update()
            self.toggled.emit(self._checked)
        super().mousePressEvent(event)

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        box_rect = QRectF(2.0, 2.0, 20.0, 20.0)
        radius = 6.5

        path = QPainterPath()
        path.addRoundedRect(box_rect, radius, radius)

        if self._checked:
            painter.fillPath(path, QColor("#34C759"))
            # 繪製清晰的白色打勾勾 (✓)
            pen = QPen(QColor("#FFFFFF"), 2.4, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
            painter.setPen(pen)
            check_path = QPainterPath()
            check_path.moveTo(QPointF(6.8, 12.2))
            check_path.lineTo(QPointF(10.5, 15.8))
            check_path.lineTo(QPointF(17.2, 8.2))
            painter.drawPath(check_path)
        else:
            painter.fillPath(path, QColor("#FFFFFF"))
            border_color = QColor("#007AFF") if self._hovered else QColor("#C7C7CC")
            pen = QPen(border_color, 1.8)
            painter.setPen(pen)
            painter.drawPath(path)

        painter.end()


class PriorityPopup(QWidget):
    """
    100% 純圓角無黑邊的 Apple 風格浮動下拉選單 (In-Window Rounded Popover)：
    - 直接渲染於當前視窗圖層上，徹底消除 Windows 原生彈出視窗四角黑底問題
    - 具備 12px 圓角白底卡片與柔和陰影
    """

    itemSelected = pyqtSignal(int)

    def __init__(
        self,
        items: list[tuple[str, str, str]],
        current_idx: int,
        anchor_widget: QWidget,
    ):
        top_win = anchor_widget.window()
        super().__init__(top_win)
        self.setGeometry(top_win.rect())
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setStyleSheet("background: transparent;")

        card_width = max(144, anchor_widget.width())
        card_height = len(items) * 38 + 16

        self.card = QFrame(self)
        self.card.setFixedSize(card_width, card_height)
        self.card.setObjectName("RoundedPopoverCard")
        self.card.setStyleSheet(
            """
            QFrame#RoundedPopoverCard {
                background-color: #FFFFFF;
                border: 1.5px solid #E5E5EA;
                border-radius: 12px;
            }
            """
        )

        shadow = QGraphicsDropShadowEffect(self.card)
        shadow.setBlurRadius(24)
        shadow.setOffset(0, 6)
        shadow.setColor(QColor(0, 0, 0, 32))
        self.card.setGraphicsEffect(shadow)

        pos = anchor_widget.mapTo(top_win, anchor_widget.rect().bottomLeft())
        x = max(8, min(pos.x(), top_win.width() - card_width - 8))
        y = pos.y() + 5
        if y + card_height > top_win.height() - 8:
            above_y = anchor_widget.mapTo(top_win, anchor_widget.rect().topLeft()).y() - card_height - 5
            y = max(8, above_y)
        self.card.move(x, y)

        layout = QVBoxLayout(self.card)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setSpacing(4)

        for idx, (color, label, _data) in enumerate(items):
            btn = QPushButton(f"  {label}")
            btn.setIcon(SvgIcons.icon(SvgIcons.DOT, color, 14))
            btn.setIconSize(QSize(14, 14))
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setFixedHeight(34)
            is_curr = idx == current_idx
            btn.setStyleSheet(
                f"""
                QPushButton {{
                    background-color: {'#EBF4FF' if is_curr else 'transparent'};
                    color: {'#007AFF' if is_curr else '#1D1D1F'};
                    border: none;
                    border-radius: 8px;
                    padding: 0 10px;
                    font-size: 14px;
                    font-weight: 700;
                    text-align: left;
                }}
                QPushButton:hover {{
                    background-color: #EBF4FF;
                    color: #007AFF;
                }}
                """
            )
            btn.clicked.connect(lambda checked=False, i=idx: self._choose(i))
            layout.addWidget(btn)

        self.raise_()
        self.show()

    def _choose(self, idx: int) -> None:
        self.itemSelected.emit(idx)
        self.close()
        self.deleteLater()

    def mousePressEvent(self, event) -> None:
        if not self.card.geometry().contains(event.pos()):
            self.close()
            self.deleteLater()
        super().mousePressEvent(event)


class PrioritySelector(QPushButton):
    """
    Apple 風格圓角優先程度下拉選單按鈕：
    - 點擊展開 100% 純圓角無黑邊的 PriorityPopup
    - 相容 QComboBox 常用介面 (currentData, setCurrentIndex, findData, showPopup, hidePopup)
    """

    currentIndexChanged = pyqtSignal(int)

    ITEMS = [
        ("#FF3B30", "高程度", "high"),
        ("#FF9500", "中程度", "medium"),
        ("#007AFF", "低程度", "low"),
    ]

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._current_idx = 1
        self._popup: PriorityPopup | None = None
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setIconSize(QSize(14, 14))
        self.setStyleSheet(
            """
            QPushButton {
                background-color: #F5F5F7;
                border: 1.5px solid #E5E5EA;
                border-radius: 10px;
                padding: 0 28px 0 12px;
                font-size: 14px;
                font-weight: 700;
                color: #1D1D1F;
                text-align: left;
            }
            QPushButton:hover {
                border-color: #C7C7CC;
                background-color: #EFEFF4;
            }
            """
        )
        self._sync_button_display()
        self.clicked.connect(self.showPopup)

    def _sync_button_display(self) -> None:
        color, label, _data = self.ITEMS[self._current_idx]
        self.setIcon(SvgIcons.icon(SvgIcons.DOT, color, 14))
        self.setText(f" {label}")

    def currentIndex(self) -> int:
        return self._current_idx

    def setCurrentIndex(self, idx: int) -> None:
        if 0 <= idx < len(self.ITEMS):
            self._current_idx = idx
            self._sync_button_display()
            self.currentIndexChanged.emit(idx)

    def currentData(self) -> str:
        return self.ITEMS[self._current_idx][2]

    def findData(self, data_val: str) -> int:
        for i, (_color, _label, d) in enumerate(self.ITEMS):
            if d == data_val:
                return i
        return -1

    def showPopup(self) -> None:
        if self._popup is not None:
            self._popup.close()
            self._popup.deleteLater()
        self._popup = PriorityPopup(self.ITEMS, self._current_idx, self)
        self._popup.itemSelected.connect(self.setCurrentIndex)

    def hidePopup(self) -> None:
        if self._popup is not None:
            self._popup.close()
            self._popup.deleteLater()
            self._popup = None

    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        arrow_pix = SvgIcons.pixmap(SvgIcons.CHEVRON_DOWN, "#6E6E73", 14)
        x = self.width() - 22
        y = (self.height() - 14) // 2
        painter.drawPixmap(x, y, arrow_pix)
        painter.end()


class AppleCalendarDialog(QDialog):
    """
    100% 純自繪 Apple 風格圓角日曆選擇彈窗：
    - 告別傳統 QCalendarWidget 擁擠排版、方正藍框與古早年份 SpinBox
    - 每個日期格皆為 40x38px 獨立圓角膠囊按鈕 (border-radius: 11px)，留白充足
    - 頂部提供圓角 SVG 按鈕切換『上/下一年』與『上/下一月』，以及『今天 / 明天 / 後天 / 下週』快捷鍵
    """

    def __init__(self, current_date_str: str, parent: QWidget | None = None):
        super().__init__(parent)
        self.setWindowTitle("選擇待辦日期")
        self.setModal(True)
        self.setFixedWidth(410)
        self.setStyleSheet("QDialog { background-color: #FFFFFF; }")

        try:
            self._selected_date = date.fromisoformat(current_date_str)
        except Exception:
            self._selected_date = date.today()

        self._view_year = self._selected_date.year
        self._view_month = self._selected_date.month

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 22)
        layout.setSpacing(14)

        # 頂部標題列
        title_row = QHBoxLayout()
        title_row.setSpacing(8)
        cal_icon = QLabel()
        cal_icon.setPixmap(SvgIcons.pixmap(SvgIcons.CALENDAR, "#007AFF", 22))
        title = QLabel("選擇待辦事項日期")
        title.setStyleSheet("font-size: 17px; font-weight: 800; color: #1D1D1F;")
        title_row.addWidget(cal_icon)
        title_row.addWidget(title)
        title_row.addStretch()
        layout.addLayout(title_row)

        # 快捷日期膠囊按鈕列 (今天 / 明天 / 後天 / 一週後) — 點擊後切換下方日曆至該日期，不直接關閉彈窗
        quick_row = QHBoxLayout()
        quick_row.setSpacing(8)
        self._quick_buttons: list[tuple[date, QPushButton]] = []
        for offset, label in ((0, "今天"), (1, "明天"), (2, "後天"), (7, "一週後")):
            q_btn = QPushButton(label)
            q_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            q_btn.setFixedHeight(34)
            target_d = date.today() + timedelta(days=offset)
            q_btn.clicked.connect(lambda checked=False, d=target_d: self._on_day_clicked(d))
            self._quick_buttons.append((target_d, q_btn))
            quick_row.addWidget(q_btn, 1)
        layout.addLayout(quick_row)

        # 日曆主卡片容器 (柔和淺灰圓角外框)
        cal_card = QFrame()
        cal_card.setStyleSheet(
            """
            QFrame {
                background-color: #F9F9FB;
                border: 1.5px solid #EBEBF0;
                border-radius: 16px;
            }
            """
        )
        cal_layout = QVBoxLayout(cal_card)
        cal_layout.setContentsMargins(16, 14, 16, 16)
        cal_layout.setSpacing(12)

        # 年月切換導覽列 (無傳統下拉選單或 SpinBox，全圓角按鈕)
        nav_row = QHBoxLayout()
        nav_row.setSpacing(6)

        nav_btn_style = """
            QPushButton {
                background-color: #FFFFFF;
                border: 1px solid #E5E5EA;
                border-radius: 10px;
            }
            QPushButton:hover {
                background-color: #EBF4FF;
                border-color: #B3D7FF;
            }
            QPushButton:pressed {
                background-color: #D6E9FF;
            }
        """

        prev_year_btn = QPushButton()
        prev_year_btn.setFixedSize(34, 34)
        prev_year_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        prev_year_btn.setToolTip("上一年")
        prev_year_btn.setIcon(SvgIcons.icon(SvgIcons.DOUBLE_LEFT, "#3A3A3C", 16))
        prev_year_btn.setStyleSheet(nav_btn_style)
        prev_year_btn.clicked.connect(lambda: self._shift_month(-12))

        prev_month_btn = QPushButton()
        prev_month_btn.setFixedSize(34, 34)
        prev_month_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        prev_month_btn.setToolTip("上個月")
        prev_month_btn.setIcon(SvgIcons.icon(SvgIcons.CHEVRON_LEFT, "#3A3A3C", 16))
        prev_month_btn.setStyleSheet(nav_btn_style)
        prev_month_btn.clicked.connect(lambda: self._shift_month(-1))

        self.month_title_lbl = QLabel()
        self.month_title_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.month_title_lbl.setStyleSheet(
            "font-size: 15.5px; font-weight: 800; color: #1D1D1F; border: none; background: transparent;"
        )

        next_month_btn = QPushButton()
        next_month_btn.setFixedSize(34, 34)
        next_month_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        next_month_btn.setToolTip("下個月")
        next_month_btn.setIcon(SvgIcons.icon(SvgIcons.CHEVRON_RIGHT, "#3A3A3C", 16))
        next_month_btn.setStyleSheet(nav_btn_style)
        next_month_btn.clicked.connect(lambda: self._shift_month(1))

        next_year_btn = QPushButton()
        next_year_btn.setFixedSize(34, 34)
        next_year_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        next_year_btn.setToolTip("下一年")
        next_year_btn.setIcon(SvgIcons.icon(SvgIcons.DOUBLE_RIGHT, "#3A3A3C", 16))
        next_year_btn.setStyleSheet(nav_btn_style)
        next_year_btn.clicked.connect(lambda: self._shift_month(12))

        nav_row.addWidget(prev_year_btn)
        nav_row.addWidget(prev_month_btn)
        nav_row.addWidget(self.month_title_lbl, 1)
        nav_row.addWidget(next_month_btn)
        nav_row.addWidget(next_year_btn)
        cal_layout.addLayout(nav_row)

        # 星期標題列 + 日期網格 (寬敞間距 6px)
        self.grid_layout = QGridLayout()
        self.grid_layout.setContentsMargins(0, 2, 0, 0)
        self.grid_layout.setHorizontalSpacing(6)
        self.grid_layout.setVerticalSpacing(6)

        weekdays = [("日", "#FF3B30"), ("一", "#8E8E93"), ("二", "#8E8E93"), ("三", "#8E8E93"), ("四", "#8E8E93"), ("五", "#8E8E93"), ("六", "#FF3B30")]
        for col, (w_text, w_color) in enumerate(weekdays):
            w_lbl = QLabel(w_text)
            w_lbl.setFixedSize(42, 26)
            w_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            w_lbl.setStyleSheet(
                f"font-size: 12.5px; font-weight: 700; color: {w_color}; border: none; background: transparent;"
            )
            self.grid_layout.addWidget(w_lbl, 0, col)

        self._day_buttons: list[QPushButton] = []
        for row in range(1, 7):
            for col in range(7):
                btn = QPushButton()
                btn.setFixedSize(42, 38)
                btn.setCursor(Qt.CursorShape.PointingHandCursor)
                self.grid_layout.addWidget(btn, row, col)
                self._day_buttons.append(btn)

        cal_layout.addLayout(self.grid_layout)
        layout.addWidget(cal_card)

        # 目前選中日期顯示列
        self.selected_preview_lbl = QLabel()
        self.selected_preview_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.selected_preview_lbl.setStyleSheet("font-size: 13px; font-weight: 700; color: #6E6E73;")
        layout.addWidget(self.selected_preview_lbl)

        # 底部確認 / 取消圓角按鈕列
        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)

        cancel_btn = QPushButton("取消")
        cancel_btn.setFixedHeight(40)
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #F2F2F7;
                color: #3A3A3C;
                border: none;
                border-radius: 11px;
                font-size: 14px;
                font-weight: 700;
            }
            QPushButton:hover { background-color: #E5E5EA; }
            """
        )
        cancel_btn.clicked.connect(self.reject)

        ok_btn = QPushButton("確認選擇")
        ok_btn.setFixedHeight(40)
        ok_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        ok_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #007AFF;
                color: #FFFFFF;
                border: none;
                border-radius: 11px;
                font-size: 14px;
                font-weight: 700;
            }
            QPushButton:hover { background-color: #0062CC; }
            """
        )
        ok_btn.clicked.connect(self.accept)

        btn_row.addWidget(cancel_btn, 1)
        btn_row.addWidget(ok_btn, 1)
        layout.addLayout(btn_row)

        self._refresh_calendar_grid()

    def _shift_month(self, delta_months: int) -> None:
        total_months = (self._view_year * 12 + (self._view_month - 1)) + delta_months
        self._view_year = max(2000, min(2100, total_months // 12))
        self._view_month = (total_months % 12) + 1
        self._refresh_calendar_grid()

    def _on_day_clicked(self, target_date: date) -> None:
        self._selected_date = target_date
        self._view_year = target_date.year
        self._view_month = target_date.month
        self._refresh_calendar_grid()

    def _select_and_close(self, target_date: date) -> None:
        self._selected_date = target_date
        self.accept()

    def _refresh_calendar_grid(self) -> None:
        self.month_title_lbl.setText(f"{self._view_year} 年 {self._view_month:02d} 月")
        self.selected_preview_lbl.setText(f"已選日期：{self._selected_date.isoformat()}")

        # 更新上方四個快捷按鈕的高亮狀態
        for target_d, q_btn in getattr(self, "_quick_buttons", []):
            if target_d == self._selected_date:
                q_btn.setStyleSheet(
                    """
                    QPushButton {
                        background-color: #007AFF;
                        color: #FFFFFF;
                        border: none;
                        border-radius: 10px;
                        font-size: 13px;
                        font-weight: 700;
                    }
                    """
                )
            else:
                q_btn.setStyleSheet(
                    """
                    QPushButton {
                        background-color: #F2F2F7;
                        color: #007AFF;
                        border: none;
                        border-radius: 10px;
                        font-size: 13px;
                        font-weight: 700;
                    }
                    QPushButton:hover {
                        background-color: #E5F1FF;
                    }
                    """
                )

        cal = calendar.Calendar(firstweekday=6)  # 星期日為第一欄
        month_weeks = cal.monthdatescalendar(self._view_year, self._view_month)
        while len(month_weeks) < 6:
            last_day = month_weeks[-1][-1]
            next_week = [last_day + timedelta(days=i) for i in range(1, 8)]
            month_weeks.append(next_week)

        today = date.today()
        flat_dates = [d for week in month_weeks[:6] for d in week]

        for idx, btn in enumerate(self._day_buttons):
            d = flat_dates[idx]
            btn.setText(str(d.day))
            try:
                btn.clicked.disconnect()
            except Exception:
                pass
            btn.clicked.connect(lambda checked=False, dt=d: self._on_day_clicked(dt))

            is_selected = d == self._selected_date
            is_today = d == today
            in_month = d.month == self._view_month
            is_weekend = d.weekday() in (5, 6)

            if is_selected:
                btn.setStyleSheet(
                    """
                    QPushButton {
                        background-color: #007AFF;
                        color: #FFFFFF;
                        border: none;
                        border-radius: 11px;
                        font-size: 13.5px;
                        font-weight: 800;
                    }
                    """
                )
            elif is_today:
                btn.setStyleSheet(
                    """
                    QPushButton {
                        background-color: #EBF4FF;
                        color: #007AFF;
                        border: 1.5px solid #80BDFF;
                        border-radius: 11px;
                        font-size: 13.5px;
                        font-weight: 800;
                    }
                    QPushButton:hover {
                        background-color: #D6E9FF;
                    }
                    """
                )
            elif in_month:
                fg = "#FF3B30" if is_weekend else "#1D1D1F"
                btn.setStyleSheet(
                    f"""
                    QPushButton {{
                        background-color: #FFFFFF;
                        color: {fg};
                        border: 1px solid #EFEFF4;
                        border-radius: 11px;
                        font-size: 13.5px;
                        font-weight: 600;
                    }}
                    QPushButton:hover {{
                        background-color: #EBF4FF;
                        color: #007AFF;
                        border-color: #B3D7FF;
                    }}
                    """
                )
            else:
                btn.setStyleSheet(
                    """
                    QPushButton {
                        background-color: transparent;
                        color: #C7C7CC;
                        border: none;
                        border-radius: 11px;
                        font-size: 13px;
                        font-weight: 500;
                    }
                    QPushButton:hover {
                        background-color: #F2F2F7;
                        color: #8E8E93;
                    }
                    """
                )

    def selected_date_str(self) -> str:
        return self._selected_date.isoformat()


class AppleDateButton(QPushButton):
    """Apple 風格日期選擇按鈕，點擊彈出日曆選擇器。"""

    dateChanged = pyqtSignal(str)

    def __init__(self, initial_date_str: str | None = None, height: int = 42, parent: QWidget | None = None):
        super().__init__(parent)
        self._date_str = initial_date_str or date.today().isoformat()
        self.setFixedHeight(height)
        self.setMinimumWidth(138)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setIcon(SvgIcons.icon(SvgIcons.CALENDAR, "#007AFF", 17))
        self.setStyleSheet(
            """
            QPushButton {
                background-color: #F5F5F7;
                border: 1.5px solid #E5E5EA;
                border-radius: 10px;
                padding: 0 12px;
                font-size: 13.5px;
                font-weight: 700;
                color: #1D1D1F;
            }
            QPushButton:hover {
                border-color: #C7C7CC;
                background-color: #EFEFF4;
            }
            """
        )
        self._refresh_text()
        self.clicked.connect(self._open_calendar)

    def _refresh_text(self) -> None:
        self.setText(f" {self._date_str}")

    def date_str(self) -> str:
        return self._date_str

    def set_date_str(self, new_date_str: str) -> None:
        self._date_str = new_date_str
        self._refresh_text()
        self.dateChanged.emit(new_date_str)

    def _open_calendar(self) -> None:
        dlg = AppleCalendarDialog(self._date_str, self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self.set_date_str(dlg.selected_date_str())


# ============================================================================
# 5. 長條膠囊狀進度條與鼓勵語邏輯 (Capsule Progress Bar & Helpers)
# ============================================================================

def get_water_encouragement(percentage: float) -> tuple[str, str]:
    """
    根據喝水完成度百分比回傳 (鼓勵文字, 強調色碼)。
    超過 80% 特別提示使用者已經快喝夠今日所需的水量。
    """
    if percentage <= 0:
        return ("今天還沒開始喝水喔，先來第一杯水開啟活力的一天吧！", "#8E8E93")
    if percentage < 40:
        return ("好的開始！記得每小時補充水分，保持身體良好代謝～", "#FF9500")
    if percentage < 80:
        return ("進度很不錯喔！已經完成將近大半了，繼續保持這個節奏！", "#30B0C7")
    if percentage < 100:
        return ("你很棒！已經快喝夠今日所需的水量了，再加把勁！", "#34C759")
    return ("太棒了！今日所需的水量已完美達標，身體感謝你的照顧 🎉", "#28CD41")


def calculate_capsule_color(percentage: float) -> QColor:
    """
    計算長條膠囊進度條的填充顏色：
    - 隨完成度 (0% ~ 100%) 增加，色相從柔和暖橘 (Hue 32°) 漸變至翠綠色 (Hue 135°, Apple Green #34C759)
    - 越靠近 100% 顏色越綠！
    """
    clamped = max(0.0, min(100.0, float(percentage)))
    ratio = clamped / 100.0
    hue = int(32 + (135 - 32) * (ratio ** 0.85))
    saturation = int(205 - 15 * ratio)
    value = int(242 - 38 * ratio)
    return QColor.fromHsv(hue, saturation, value)


class CapsuleProgressBar(QWidget):
    """
    長條膠囊狀進度條 (Capsule Progress Bar)
    - 原始背景軌道為灰色 (#E5E5EA)
    - 填充條為長膠囊圓角，隨完成度平滑過渡寬度與顏色，越靠近 100% 越綠
    """

    def __init__(self, height: int = 30, parent: QWidget | None = None):
        super().__init__(parent)
        self._percentage = 0.0
        self._display_percentage = 0.0
        self.setFixedHeight(height)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

        self._anim = QVariantAnimation(self)
        self._anim.setDuration(420)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._on_anim_value)

    def _on_anim_value(self, val: float) -> None:
        self._display_percentage = float(val)
        self.update()

    def set_percentage(self, percentage: float, animate: bool = True) -> None:
        target = max(0.0, float(percentage))
        self._percentage = target
        self._anim.stop()
        if animate:
            self._anim.setStartValue(self._display_percentage)
            self._anim.setEndValue(min(100.0, target))
            self._anim.start()
        else:
            self._display_percentage = min(100.0, target)
            self.update()

    def percentage(self) -> float:
        return self._percentage

    def current_fill_color(self) -> QColor:
        return calculate_capsule_color(self._percentage)

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        rect = QRectF(self.rect())
        radius = rect.height() / 2.0

        # 1. 原始灰色膠囊軌道背景 (#E5E5EA)
        track_path = QPainterPath()
        track_path.addRoundedRect(rect, radius, radius)
        painter.fillPath(track_path, QColor("#E5E5EA"))

        # 2. 動態變色膠囊填充條 (越靠近 100% 越綠)
        if self._display_percentage > 0.2:
            ratio = min(1.0, max(0.0, self._display_percentage / 100.0))
            fill_width = max(rect.height(), rect.width() * ratio)
            fill_rect = QRectF(0, 0, min(rect.width(), fill_width), rect.height())

            painter.save()
            painter.setClipPath(track_path)
            fill_path = QPainterPath()
            fill_path.addRoundedRect(fill_rect, radius, radius)
            fill_color = calculate_capsule_color(self._display_percentage)
            painter.fillPath(fill_path, fill_color)

            gloss_rect = QRectF(fill_rect.left() + 6, 3, max(0.0, fill_rect.width() - 12), rect.height() * 0.32)
            gloss_path = QPainterPath()
            gloss_path.addRoundedRect(gloss_rect, radius * 0.4, radius * 0.4)
            painter.fillPath(gloss_path, QColor(255, 255, 255, 55))
            painter.restore()

        painter.end()


# ============================================================================
# 6. 溫馨提醒彈窗與編輯待辦彈窗 (Dialogs)
# ============================================================================

class ReminderDialog(QDialog):
    """當每小時喝水或每工作 1 小時休息時間到時跳出的 Apple 風格提醒彈窗。"""

    def __init__(
        self,
        title: str,
        message: str,
        primary_btn_text: str,
        icon_svg: str,
        accent_color: str,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setModal(True)
        self.setFixedWidth(420)
        self.setStyleSheet(
            """
            QDialog {
                background-color: #FFFFFF;
            }
            QLabel#DialogTitle {
                font-size: 19px;
                font-weight: 700;
                color: #1D1D1F;
            }
            QLabel#DialogMsg {
                font-size: 14px;
                color: #515154;
                line-height: 1.5;
            }
            """
        )

        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 24)
        layout.setSpacing(16)

        icon_lbl = QLabel()
        icon_lbl.setPixmap(SvgIcons.pixmap(icon_svg, color=accent_color, size=48))
        icon_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(icon_lbl)

        title_lbl = QLabel(title)
        title_lbl.setObjectName("DialogTitle")
        title_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title_lbl)

        msg_lbl = QLabel(message)
        msg_lbl.setObjectName("DialogMsg")
        msg_lbl.setWordWrap(True)
        msg_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(msg_lbl)

        layout.addSpacing(6)

        btn_row = QHBoxLayout()
        btn_row.setSpacing(12)

        later_btn = QPushButton("稍後再說")
        later_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        later_btn.setFixedHeight(40)
        later_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #F2F2F7;
                color: #3A3A3C;
                border: none;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 600;
                padding: 0 18px;
            }
            QPushButton:hover {
                background-color: #E5E5EA;
            }
            """
        )
        later_btn.clicked.connect(self.reject)

        action_btn = QPushButton(primary_btn_text)
        action_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        action_btn.setFixedHeight(40)
        action_btn.setStyleSheet(
            f"""
            QPushButton {{
                background-color: {accent_color};
                color: #FFFFFF;
                border: none;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 600;
                padding: 0 20px;
            }}
            QPushButton:hover {{
                opacity: 0.92;
            }}
            """
        )
        action_btn.clicked.connect(self.accept)

        btn_row.addWidget(later_btn, 1)
        btn_row.addWidget(action_btn, 2)
        layout.addLayout(btn_row)


class EditTodoDialog(QDialog):
    """修改待辦事項文字、優先級程度 (低/中/高) 與日期的彈窗。"""

    def __init__(
        self,
        current_title: str,
        current_priority: str,
        current_date_str: str,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle("修改待辦事項")
        self.setModal(True)
        self.setFixedWidth(430)
        self.setStyleSheet("QDialog { background-color: #FFFFFF; }")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 24, 24, 22)
        layout.setSpacing(14)

        header = QLabel("修改待辦事項")
        header.setStyleSheet("font-size: 17px; font-weight: 700; color: #1D1D1F;")
        layout.addWidget(header)

        lbl_title = QLabel("事項內容：")
        lbl_title.setStyleSheet("font-size: 13px; font-weight: 600; color: #6E6E73;")
        layout.addWidget(lbl_title)

        self.title_input = QLineEdit(current_title)
        self.title_input.setFixedHeight(40)
        self.title_input.setStyleSheet(
            """
            QLineEdit {
                background-color: #F5F5F7;
                border: 1.5px solid #E5E5EA;
                border-radius: 10px;
                padding: 0 12px;
                font-size: 14px;
                color: #1D1D1F;
            }
            QLineEdit:focus {
                border: 1.5px solid #007AFF;
                background-color: #FFFFFF;
            }
            """
        )
        layout.addWidget(self.title_input)

        meta_row = QHBoxLayout()
        meta_row.setSpacing(12)

        prio_col = QVBoxLayout()
        prio_col.setSpacing(6)
        lbl_prio = QLabel("優先程度：")
        lbl_prio.setStyleSheet("font-size: 13px; font-weight: 600; color: #6E6E73;")
        self.priority_combo = PrioritySelector(self)
        self.priority_combo.setFixedHeight(40)
        idx = self.priority_combo.findData(current_priority)
        if idx >= 0:
            self.priority_combo.setCurrentIndex(idx)
        prio_col.addWidget(lbl_prio)
        prio_col.addWidget(self.priority_combo)

        date_col = QVBoxLayout()
        date_col.setSpacing(6)
        lbl_date = QLabel("預定日期：")
        lbl_date.setStyleSheet("font-size: 13px; font-weight: 600; color: #6E6E73;")
        self.date_btn = AppleDateButton(current_date_str, height=40, parent=self)
        date_col.addWidget(lbl_date)
        date_col.addWidget(self.date_btn)

        meta_row.addLayout(prio_col, 1)
        meta_row.addLayout(date_col, 1)
        layout.addLayout(meta_row)

        layout.addSpacing(8)

        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)

        cancel_btn = QPushButton("取消")
        cancel_btn.setFixedHeight(38)
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #F2F2F7;
                color: #3A3A3C;
                border: none;
                border-radius: 9px;
                font-size: 14px;
                font-weight: 600;
            }
            QPushButton:hover { background-color: #E5E5EA; }
            """
        )
        cancel_btn.clicked.connect(self.reject)

        save_btn = QPushButton("儲存修改")
        save_btn.setFixedHeight(38)
        save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        save_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #007AFF;
                color: #FFFFFF;
                border: none;
                border-radius: 9px;
                font-size: 14px;
                font-weight: 600;
            }
            QPushButton:hover { background-color: #0066D6; }
            """
        )
        save_btn.clicked.connect(self._on_save)

        btn_row.addWidget(cancel_btn, 1)
        btn_row.addWidget(save_btn, 1)
        layout.addLayout(btn_row)

    def _on_save(self) -> None:
        if self.title_input.text().strip():
            self.accept()

    def get_values(self) -> tuple[str, str, str]:
        return (
            self.title_input.text().strip(),
            self.priority_combo.currentData(),
            self.date_btn.date_str(),
        )


# ============================================================================
# 7. 頁籤一：喝水提醒 & 打卡 (WaterTab)
# ============================================================================

class WaterTab(QWidget):
    """
    頁籤 1：喝水提醒 & 打卡
    - 預設每日目標 3000 cc (可設定修改，cc 為淺灰不可選取，現代化 Apple 上下按鈕)
    - 支援一鍵重置今日喝水量按鈕
    - 顯示格式：1000 / 3000 cc (完成度 33%) 與距離目標剩餘水量
    - 膠囊狀進度條：灰底 (#E5E5EA)，隨完成度變綠 (越接近 100% 越綠)
    - 動態鼓勵語：超過 80% 顯示「你很棒！已經快喝夠今日所需的水量了，再加把勁！」
    - 每小時固定提醒要喝水
    """

    HOURLY_SECONDS = 3600

    def __init__(self, storage: StorageManager, notify_callback, parent: QWidget | None = None):
        super().__init__(parent)
        self.storage = storage
        self.notify_callback = notify_callback
        self.remaining_seconds = self.HOURLY_SECONDS

        self._build_ui()
        self.refresh_ui(animate=False)

    def _make_card(self) -> QFrame:
        card = QFrame()
        card.setObjectName("AppleCard")
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(22)
        shadow.setOffset(0, 4)
        shadow.setColor(QColor(0, 0, 0, 14))
        card.setGraphicsEffect(shadow)
        return card

    def _build_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 8, 0, 0)
        main_layout.setSpacing(16)

        # --- 卡片 1：目標設定 + 核心進度 + 長條膠囊進度條 + 鼓勵語 ---
        progress_card = self._make_card()
        p_layout = QVBoxLayout(progress_card)
        p_layout.setContentsMargins(24, 22, 24, 22)
        p_layout.setSpacing(14)

        top_row = QHBoxLayout()
        title_box = QHBoxLayout()
        title_box.setSpacing(8)
        icon_lbl = QLabel()
        icon_lbl.setPixmap(SvgIcons.pixmap(SvgIcons.WATER_DROP, "#007AFF", 22))
        title_lbl = QLabel("今日喝水進度")
        title_lbl.setStyleSheet("font-size: 17px; font-weight: 700; color: #1D1D1F;")
        title_box.addWidget(icon_lbl)
        title_box.addWidget(title_lbl)
        top_row.addLayout(title_box)
        top_row.addStretch()

        goal_lbl = QLabel("今日目標：")
        goal_lbl.setStyleSheet("font-size: 13px; color: #6E6E73; font-weight: 600;")

        # 現代化 Apple 風格數值調整框 (純數字輸入 + 淺灰不可選取 cc + SVG 上下微調)
        self.goal_spin = AppleNumberStepper(
            minimum=500,
            maximum=10000,
            step=100,
            value=int(self.storage.data["water"].get("goal_cc", 3000)),
            unit_text="cc",
            height=36,
            parent=self,
        )
        self.goal_spin.valueChanged.connect(self._on_goal_changed)

        reset_goal_btn = QPushButton("預設 3000cc")
        reset_goal_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        reset_goal_btn.setFixedHeight(36)
        reset_goal_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #F2F2F7;
                color: #007AFF;
                border: none;
                border-radius: 9px;
                padding: 0 12px;
                font-size: 12.5px;
                font-weight: 700;
            }
            QPushButton:hover { background-color: #E5E5EA; }
            """
        )
        reset_goal_btn.clicked.connect(lambda: self.goal_spin.setValue(3000))

        # 一鍵重置今日喝水量按鈕
        self.reset_water_btn = QPushButton(" 重置喝水量")
        self.reset_water_btn.setIcon(SvgIcons.icon(SvgIcons.RESET, "#FF3B30", 15))
        self.reset_water_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.reset_water_btn.setFixedHeight(36)
        self.reset_water_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #FFEBEA;
                color: #FF3B30;
                border: none;
                border-radius: 9px;
                padding: 0 12px;
                font-size: 12.5px;
                font-weight: 700;
            }
            QPushButton:hover { background-color: #FFD5D2; }
            """
        )
        self.reset_water_btn.clicked.connect(self.reset_today_water)

        top_row.addWidget(goal_lbl)
        top_row.addWidget(self.goal_spin)
        top_row.addWidget(reset_goal_btn)
        top_row.addWidget(self.reset_water_btn)
        p_layout.addLayout(top_row)

        # 主數據呈現：1000 / 3000 cc (完成度 33%) 與距離目標剩餘
        stats_row = QHBoxLayout()
        self.main_status_label = QLabel("0 / 3000 cc (完成度 0%)")
        self.main_status_label.setStyleSheet("font-size: 26px; font-weight: 800; color: #1D1D1F;")
        self.remain_status_label = QLabel("距離目標還剩 3000 cc")
        self.remain_status_label.setStyleSheet("font-size: 14px; font-weight: 600; color: #6E6E73;")
        stats_row.addWidget(self.main_status_label)
        stats_row.addStretch()
        stats_row.addWidget(self.remain_status_label)
        p_layout.addLayout(stats_row)

        # 長條膠囊狀進度條 (原始背景灰色，越靠近 100% 越綠)
        self.capsule_bar = CapsuleProgressBar(height=30)
        p_layout.addWidget(self.capsule_bar)

        # 動態鼓勵語橫幅
        self.encourage_banner = QLabel()
        self.encourage_banner.setWordWrap(True)
        p_layout.addWidget(self.encourage_banner)

        main_layout.addWidget(progress_card)

        # --- 卡片 2：喝水打卡區 (快捷按鈕 + 自訂輸入) ---
        checkin_card = self._make_card()
        c_layout = QVBoxLayout(checkin_card)
        c_layout.setContentsMargins(24, 18, 24, 18)
        c_layout.setSpacing(12)

        c_title = QLabel("記錄每次喝水打卡")
        c_title.setStyleSheet("font-size: 15px; font-weight: 700; color: #1D1D1F;")
        c_layout.addWidget(c_title)

        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)
        for amount in (150, 250, 350, 500):
            q_btn = QPushButton(f"+ {amount} cc")
            q_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            q_btn.setFixedHeight(40)
            q_btn.setStyleSheet(
                """
                QPushButton {
                    background-color: #EBF4FF;
                    color: #007AFF;
                    border: 1px solid #C7E0FF;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 700;
                }
                QPushButton:hover {
                    background-color: #007AFF;
                    color: #FFFFFF;
                }
                """
            )
            q_btn.clicked.connect(lambda checked=False, amt=amount: self.add_water(amt))
            btn_row.addWidget(q_btn, 1)

        # 自訂水量輸入 (Apple 現代化微調器，cc 淺灰不可選取)
        self.custom_water_spin = AppleNumberStepper(
            minimum=10,
            maximum=5000,
            step=50,
            value=200,
            unit_text="cc",
            height=40,
            parent=self,
        )

        add_custom_btn = QPushButton("自訂打卡")
        add_custom_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_custom_btn.setFixedHeight(40)
        add_custom_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #007AFF;
                color: #FFFFFF;
                border: none;
                border-radius: 10px;
                padding: 0 18px;
                font-size: 14px;
                font-weight: 700;
            }
            QPushButton:hover { background-color: #0062CC; }
            """
        )
        add_custom_btn.clicked.connect(lambda: self.add_water(self.custom_water_spin.value()))

        btn_row.addWidget(self.custom_water_spin)
        btn_row.addWidget(add_custom_btn)
        c_layout.addLayout(btn_row)
        main_layout.addWidget(checkin_card)

        # --- 卡片 3：每小時固定提醒倒數 + 今日打卡紀錄 ---
        bottom_card = self._make_card()
        b_layout = QVBoxLayout(bottom_card)
        b_layout.setContentsMargins(24, 18, 24, 18)
        b_layout.setSpacing(12)

        timer_row = QHBoxLayout()
        bell_icon = QLabel()
        bell_icon.setPixmap(SvgIcons.pixmap(SvgIcons.BELL, "#007AFF", 18))
        self.hourly_timer_label = QLabel("每小時喝水提醒倒數：60:00")
        self.hourly_timer_label.setStyleSheet("font-size: 14px; font-weight: 700; color: #1D1D1F;")

        test_remind_btn = QPushButton("立即測試喝水提醒")
        test_remind_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        test_remind_btn.setFixedHeight(30)
        test_remind_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #F2F2F7;
                color: #3A3A3C;
                border: none;
                border-radius: 8px;
                padding: 0 12px;
                font-size: 12px;
                font-weight: 600;
            }
            QPushButton:hover { background-color: #E5E5EA; }
            """
        )
        test_remind_btn.clicked.connect(self.trigger_water_reminder)

        timer_row.addWidget(bell_icon)
        timer_row.addWidget(self.hourly_timer_label)
        timer_row.addStretch()
        timer_row.addWidget(test_remind_btn)
        b_layout.addLayout(timer_row)

        self.log_scroll = QScrollArea()
        self.log_scroll.setWidgetResizable(True)
        self.log_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.log_scroll.setStyleSheet("QScrollArea { background: transparent; }")
        self.log_container = QWidget()
        self.log_container.setStyleSheet("background: transparent;")
        self.log_layout = QVBoxLayout(self.log_container)
        self.log_layout.setContentsMargins(0, 4, 0, 4)
        self.log_layout.setSpacing(6)
        self.log_scroll.setWidget(self.log_container)
        b_layout.addWidget(self.log_scroll)

        main_layout.addWidget(bottom_card, 1)

    def _on_goal_changed(self, new_goal: int) -> None:
        self.storage.data["water"]["goal_cc"] = int(new_goal)
        self.storage.save()
        self.refresh_ui(animate=True)

    def reset_today_water(self) -> None:
        """一鍵將今日已喝水量與今日打卡紀錄歸零。"""
        water_data = self.storage.data["water"]
        water_data["current_cc"] = 0
        water_data["logs"] = []
        self.storage.save()
        self.refresh_ui(animate=True)

    def add_water(self, amount_cc: int) -> None:
        if amount_cc <= 0:
            return
        water_data = self.storage.data["water"]
        water_data["current_cc"] = int(water_data.get("current_cc", 0)) + int(amount_cc)
        water_data["logs"].insert(
            0,
            {
                "id": str(uuid.uuid4()),
                "time": datetime.now().strftime("%H:%M:%S"),
                "amount": int(amount_cc),
            },
        )
        self.storage.save()
        self.refresh_ui(animate=True)

    def remove_water_log(self, log_id: str) -> None:
        water_data = self.storage.data["water"]
        logs = water_data.get("logs", [])
        target = next((item for item in logs if item.get("id") == log_id), None)
        if target:
            water_data["logs"] = [item for item in logs if item.get("id") != log_id]
            water_data["current_cc"] = max(0, int(water_data.get("current_cc", 0)) - int(target.get("amount", 0)))
            self.storage.save()
            self.refresh_ui(animate=True)

    def refresh_ui(self, animate: bool = True) -> None:
        water_data = self.storage.data["water"]
        goal_cc = max(1, int(water_data.get("goal_cc", 3000)))
        current_cc = max(0, int(water_data.get("current_cc", 0)))
        pct = int(round((current_cc / goal_cc) * 100))
        remaining_cc = max(0, goal_cc - current_cc)

        self.main_status_label.setText(f"{current_cc} / {goal_cc} cc (完成度 {pct}%)")
        if remaining_cc > 0:
            self.remain_status_label.setText(f"距離目標還剩 {remaining_cc} cc")
            self.remain_status_label.setStyleSheet("font-size: 14px; font-weight: 600; color: #6E6E73;")
        else:
            extra = current_cc - goal_cc
            extra_str = f" (超額 +{extra} cc)" if extra > 0 else ""
            self.remain_status_label.setText(f"已達成今日目標！{extra_str}")
            self.remain_status_label.setStyleSheet("font-size: 14px; font-weight: 700; color: #28CD41;")

        self.capsule_bar.set_percentage((current_cc / goal_cc) * 100.0, animate=animate)

        msg, accent = get_water_encouragement((current_cc / goal_cc) * 100.0)
        self.encourage_banner.setText(msg)
        self.encourage_banner.setStyleSheet(
            f"""
            QLabel {{
                background-color: #F5F5F7;
                border-left: 4px solid {accent};
                border-radius: 8px;
                padding: 10px 14px;
                font-size: 13.5px;
                font-weight: 600;
                color: #1D1D1F;
            }}
            """
        )

        # 重繪今日喝水打卡列表
        while self.log_layout.count():
            child = self.log_layout.takeAt(0)
            w = child.widget()
            if w is not None:
                w.setParent(None)
                w.deleteLater()

        logs = water_data.get("logs", [])
        if not logs:
            empty_lbl = QLabel("今日尚無喝水打卡紀錄，點擊上方按鈕開始第一筆紀錄吧！")
            empty_lbl.setStyleSheet("font-size: 13px; color: #8E8E93; padding: 12px 0;")
            empty_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.log_layout.addWidget(empty_lbl)
        else:
            for item in logs:
                row_frame = QFrame()
                row_frame.setStyleSheet("QFrame { background-color: #F9F9FB; border-radius: 8px; }")
                r_layout = QHBoxLayout(row_frame)
                r_layout.setContentsMargins(12, 6, 12, 6)
                t_lbl = QLabel(f"🕒 {item['time']}")
                t_lbl.setStyleSheet("font-size: 13px; color: #6E6E73; font-weight: 600;")
                amt_lbl = QLabel(f"喝了 +{item['amount']} cc")
                amt_lbl.setStyleSheet("font-size: 13px; color: #007AFF; font-weight: 700;")

                del_btn = QPushButton("刪除")
                del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                del_btn.setFixedHeight(24)
                del_btn.setStyleSheet(
                    """
                    QPushButton {
                        background: transparent;
                        color: #FF3B30;
                        border: none;
                        font-size: 12px;
                        font-weight: 600;
                    }
                    QPushButton:hover { text-decoration: underline; }
                    """
                )
                log_id = item["id"]
                del_btn.clicked.connect(lambda checked=False, lid=log_id: self.remove_water_log(lid))

                r_layout.addWidget(t_lbl)
                r_layout.addSpacing(12)
                r_layout.addWidget(amt_lbl)
                r_layout.addStretch()
                r_layout.addWidget(del_btn)
                self.log_layout.addWidget(row_frame)
            self.log_layout.addStretch()

    def tick_second(self) -> None:
        self.remaining_seconds -= 1
        if self.remaining_seconds <= 0:
            self.remaining_seconds = self.HOURLY_SECONDS
            self.trigger_water_reminder()
        mins, secs = divmod(self.remaining_seconds, 60)
        self.hourly_timer_label.setText(f"每小時喝水提醒倒數：{mins:02d}:{secs:02d}")

    def trigger_water_reminder(self) -> None:
        water_data = self.storage.data["water"]
        goal_cc = max(1, int(water_data.get("goal_cc", 3000)))
        current_cc = int(water_data.get("current_cc", 0))
        remain = max(0, goal_cc - current_cc)
        msg = f"已經過了 1 小時囉，該喝水補充水分了！\n目前已喝 {current_cc} / {goal_cc} cc，距離今日目標還差 {remain} cc。"

        self.notify_callback(
            title="💧 喝水時間到囉！",
            message=msg,
            primary_btn_text="馬上喝一杯打卡 (+250 cc)",
            icon_svg=SvgIcons.WATER_DROP,
            accent_color="#007AFF",
            on_accept=lambda: self.add_water(250),
        )


# ============================================================================
# 8. 頁籤二：休息提醒 & 打卡 (BreakTab)
# ============================================================================

class BreakTab(QWidget):
    """
    頁籤 2：休息提醒 & 打卡 (每工作 1 小時休息 10 分鐘)
    - 可設定上班時間 (若未設定預設為 09:00，採用現代化 AppleTimeStepper)
    """

    WORK_DURATION_SEC = 60 * 60
    REST_DURATION_SEC = 10 * 60

    STATE_WORKING = "working"
    STATE_BREAK_DUE = "break_due"
    STATE_RESTING = "resting"

    def __init__(self, storage: StorageManager, notify_callback, parent: QWidget | None = None):
        super().__init__(parent)
        self.storage = storage
        self.notify_callback = notify_callback

        self.state = self.STATE_WORKING
        self.remaining_seconds = self.WORK_DURATION_SEC
        self.current_rest_start_str = ""

        self._init_timer_from_work_start()
        self._build_ui()
        self.refresh_ui()

    def _init_timer_from_work_start(self) -> None:
        start_str = self.storage.data["break_tracker"].get("work_start_time", "09:00")
        try:
            parts = [int(x) for x in start_str.split(":")]
            now = datetime.now()
            start_dt = now.replace(hour=parts[0], minute=parts[1], second=0, microsecond=0)
            if now >= start_dt:
                elapsed = int((now - start_dt).total_seconds()) % self.WORK_DURATION_SEC
                self.remaining_seconds = max(60, self.WORK_DURATION_SEC - elapsed)
            else:
                self.remaining_seconds = self.WORK_DURATION_SEC
        except Exception:
            self.remaining_seconds = self.WORK_DURATION_SEC

    def _make_card(self) -> QFrame:
        card = QFrame()
        card.setObjectName("AppleCard")
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(22)
        shadow.setOffset(0, 4)
        shadow.setColor(QColor(0, 0, 0, 14))
        card.setGraphicsEffect(shadow)
        return card

    def _build_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 8, 0, 0)
        main_layout.setSpacing(16)

        status_card = self._make_card()
        s_layout = QVBoxLayout(status_card)
        s_layout.setContentsMargins(24, 22, 24, 22)
        s_layout.setSpacing(16)

        top_row = QHBoxLayout()
        icon_lbl = QLabel()
        icon_lbl.setPixmap(SvgIcons.pixmap(SvgIcons.COFFEE_BREAK, "#34C759", 22))
        title_lbl = QLabel("工作與休息循環")
        title_lbl.setStyleSheet("font-size: 17px; font-weight: 700; color: #1D1D1F;")
        top_row.addWidget(icon_lbl)
        top_row.addWidget(title_lbl)
        top_row.addStretch()

        start_lbl = QLabel("上班時間 (預設 09:00)：")
        start_lbl.setStyleSheet("font-size: 13px; color: #6E6E73; font-weight: 600;")

        saved_time = self.storage.data["break_tracker"].get("work_start_time", "09:00")
        qtime = QTime.fromString(saved_time, "HH:mm")
        if not qtime.isValid():
            qtime = QTime(9, 0)

        self.time_edit = AppleTimeStepper(initial_time=qtime, height=36, parent=self)
        self.time_edit.timeChanged.connect(self._on_work_time_changed)

        default_time_btn = QPushButton("設回 09:00")
        default_time_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        default_time_btn.setFixedHeight(36)
        default_time_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #F2F2F7;
                color: #007AFF;
                border: none;
                border-radius: 9px;
                padding: 0 12px;
                font-size: 12.5px;
                font-weight: 700;
            }
            QPushButton:hover { background-color: #E5E5EA; }
            """
        )
        default_time_btn.clicked.connect(lambda: self.time_edit.setTime(QTime(9, 0)))

        # 一鍵重置休息提醒與今日打卡紀錄按鈕
        self.reset_break_btn = QPushButton(" 重置休息提醒")
        self.reset_break_btn.setIcon(SvgIcons.icon(SvgIcons.RESET, "#FF3B30", 15))
        self.reset_break_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.reset_break_btn.setFixedHeight(36)
        self.reset_break_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #FFEBEA;
                color: #FF3B30;
                border: none;
                border-radius: 9px;
                padding: 0 12px;
                font-size: 12.5px;
                font-weight: 700;
            }
            QPushButton:hover { background-color: #FFD5D2; }
            """
        )
        self.reset_break_btn.clicked.connect(self.reset_today_breaks)

        top_row.addWidget(start_lbl)
        top_row.addWidget(self.time_edit)
        top_row.addWidget(default_time_btn)
        top_row.addWidget(self.reset_break_btn)
        s_layout.addLayout(top_row)

        center_box = QFrame()
        center_box.setStyleSheet("QFrame { background-color: #F5F5F7; border-radius: 14px; }")
        cb_layout = QVBoxLayout(center_box)
        cb_layout.setContentsMargins(20, 20, 20, 20)
        cb_layout.setSpacing(8)

        self.phase_badge = QLabel("💻 專注工作中 (每滿 1 小時提醒休息)")
        self.phase_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.phase_badge.setStyleSheet("font-size: 14px; font-weight: 700; color: #007AFF;")

        self.big_timer_label = QLabel("60:00")
        self.big_timer_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.big_timer_label.setStyleSheet("font-size: 46px; font-weight: 800; color: #1D1D1F;")

        self.sub_hint_label = QLabel("上班時間 09:00｜距離下次休息還有 60 分鐘")
        self.sub_hint_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.sub_hint_label.setStyleSheet("font-size: 13px; color: #6E6E73; font-weight: 600;")

        cb_layout.addWidget(self.phase_badge)
        cb_layout.addWidget(self.big_timer_label)
        cb_layout.addWidget(self.sub_hint_label)
        s_layout.addWidget(center_box)

        self.cycle_bar = CapsuleProgressBar(height=22)
        s_layout.addWidget(self.cycle_bar)

        action_row = QHBoxLayout()
        action_row.setSpacing(12)

        self.checkin_break_btn = QPushButton("☕ 開始休息打卡 (10 分鐘)")
        self.checkin_break_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.checkin_break_btn.setFixedHeight(44)
        self.checkin_break_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #34C759;
                color: #FFFFFF;
                border: none;
                border-radius: 11px;
                font-size: 15px;
                font-weight: 700;
                padding: 0 22px;
            }
            QPushButton:hover { background-color: #2DB84D; }
            """
        )
        self.checkin_break_btn.clicked.connect(self.start_break_checkin)

        self.reset_work_btn = QPushButton("開始新一輪 60 分鐘工作")
        self.reset_work_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.reset_work_btn.setFixedHeight(44)
        self.reset_work_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #F2F2F7;
                color: #1D1D1F;
                border: none;
                border-radius: 11px;
                font-size: 14px;
                font-weight: 600;
                padding: 0 16px;
            }
            QPushButton:hover { background-color: #E5E5EA; }
            """
        )
        self.reset_work_btn.clicked.connect(self.start_work_cycle)

        test_break_btn = QPushButton("模擬 1 小時到點提醒")
        test_break_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        test_break_btn.setFixedHeight(44)
        test_break_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #FFF4E5;
                color: #FF9500;
                border: 1px solid #FFD699;
                border-radius: 11px;
                font-size: 13px;
                font-weight: 700;
                padding: 0 14px;
            }
            QPushButton:hover { background-color: #FFE8C2; }
            """
        )
        test_break_btn.clicked.connect(self.trigger_break_due)

        action_row.addWidget(self.checkin_break_btn, 2)
        action_row.addWidget(self.reset_work_btn, 1)
        action_row.addWidget(test_break_btn, 1)
        s_layout.addLayout(action_row)

        main_layout.addWidget(status_card)

        history_card = self._make_card()
        h_layout = QVBoxLayout(history_card)
        h_layout.setContentsMargins(24, 18, 24, 18)
        h_layout.setSpacing(10)

        h_top = QHBoxLayout()
        self.break_count_label = QLabel("今日休息打卡紀錄 (已完成 0 次)")
        self.break_count_label.setStyleSheet("font-size: 15px; font-weight: 700; color: #1D1D1F;")
        h_top.addWidget(self.break_count_label)
        h_top.addStretch()
        h_layout.addLayout(h_top)

        self.break_scroll = QScrollArea()
        self.break_scroll.setWidgetResizable(True)
        self.break_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.break_scroll.setStyleSheet("QScrollArea { background: transparent; }")
        self.break_list_container = QWidget()
        self.break_list_container.setStyleSheet("background: transparent;")
        self.break_list_layout = QVBoxLayout(self.break_list_container)
        self.break_list_layout.setContentsMargins(0, 4, 0, 4)
        self.break_list_layout.setSpacing(6)
        self.break_scroll.setWidget(self.break_list_container)
        h_layout.addWidget(self.break_scroll)

        main_layout.addWidget(history_card, 1)

    def _on_work_time_changed(self, new_time: QTime) -> None:
        time_str = new_time.toString("HH:mm")
        self.storage.data["break_tracker"]["work_start_time"] = time_str
        self.storage.save()
        if self.state == self.STATE_WORKING:
            self._init_timer_from_work_start()
        self.refresh_ui()

    def start_work_cycle(self) -> None:
        self.state = self.STATE_WORKING
        self.remaining_seconds = self.WORK_DURATION_SEC
        self.refresh_ui()

    def reset_today_breaks(self) -> None:
        """一鍵重置休息提醒倒數至 60:00 並清空今日休息打卡紀錄。"""
        self.state = self.STATE_WORKING
        self.remaining_seconds = self.WORK_DURATION_SEC
        self.storage.data["break_tracker"]["logs"] = []
        self.storage.save()
        self.refresh_ui()

    def start_break_checkin(self) -> None:
        self.state = self.STATE_RESTING
        self.remaining_seconds = self.REST_DURATION_SEC
        now_str = datetime.now().strftime("%H:%M:%S")
        self.current_rest_start_str = now_str

        logs = self.storage.data["break_tracker"].get("logs", [])
        logs.insert(
            0,
            {
                "id": str(uuid.uuid4()),
                "time": now_str,
                "duration_min": 10,
                "note": "完成 1 小時工作，休息 10 分鐘打卡",
            },
        )
        self.storage.save()
        self.refresh_ui()

    def trigger_break_due(self) -> None:
        self.state = self.STATE_BREAK_DUE
        self.remaining_seconds = 0
        self.refresh_ui()
        self.notify_callback(
            title="☕ 該休息啦～已經工作滿 1 小時囉！",
            message="辛苦了！你已經連續專注工作 1 小時，請離開座位走動、看遠方休息 10 分鐘吧～",
            primary_btn_text="開始休息打卡 (10 分鐘)",
            icon_svg=SvgIcons.COFFEE_BREAK,
            accent_color="#34C759",
            on_accept=self.start_break_checkin,
        )

    def tick_second(self) -> None:
        if self.state == self.STATE_WORKING:
            self.remaining_seconds -= 1
            if self.remaining_seconds <= 0:
                self.trigger_break_due()
            else:
                self._update_timer_labels()
        elif self.state == self.STATE_RESTING:
            self.remaining_seconds -= 1
            if self.remaining_seconds <= 0:
                self.start_work_cycle()
                self.notify_callback(
                    title="✨ 10 分鐘休息結束囉！",
                    message="精神充飽電了嗎？我們已經自動為你開啟下一輪 60 分鐘工作計時，繼續加油！",
                    primary_btn_text="開始專注工作",
                    icon_svg=SvgIcons.COFFEE_BREAK,
                    accent_color="#007AFF",
                    on_accept=None,
                )
            else:
                self._update_timer_labels()

    def _update_timer_labels(self) -> None:
        mins, secs = divmod(max(0, self.remaining_seconds), 60)
        self.big_timer_label.setText(f"{mins:02d}:{secs:02d}")
        work_start = self.storage.data["break_tracker"].get("work_start_time", "09:00")

        if self.state == self.STATE_WORKING:
            self.phase_badge.setText("💻 專注工作中 (每工作 1 小時休息 10 分鐘)")
            self.phase_badge.setStyleSheet("font-size: 14px; font-weight: 700; color: #007AFF;")
            self.sub_hint_label.setText(f"設定上班時間：{work_start} ｜ 距離休息提醒還有 {mins} 分 {secs} 秒")
            done_pct = ((self.WORK_DURATION_SEC - self.remaining_seconds) / self.WORK_DURATION_SEC) * 100.0
            self.cycle_bar.set_percentage(done_pct, animate=False)
        elif self.state == self.STATE_BREAK_DUE:
            self.phase_badge.setText("🔔 該休息啦～已滿 1 小時工作！")
            self.phase_badge.setStyleSheet("font-size: 15px; font-weight: 800; color: #FF9500;")
            self.sub_hint_label.setText("請點擊下方「開始休息打卡 (10 分鐘)」讓眼睛與身體放鬆一下！")
            self.cycle_bar.set_percentage(100.0, animate=True)
        elif self.state == self.STATE_RESTING:
            self.phase_badge.setText("🌿 休息充電中 (10 分鐘倒數)")
            self.phase_badge.setStyleSheet("font-size: 14px; font-weight: 700; color: #34C759;")
            self.sub_hint_label.setText(f"正在進行 10 分鐘休息 ｜ 剩餘 {mins} 分 {secs} 秒後進入下一輪工作")
            done_pct = ((self.REST_DURATION_SEC - self.remaining_seconds) / self.REST_DURATION_SEC) * 100.0
            self.cycle_bar.set_percentage(done_pct, animate=False)

    def refresh_ui(self) -> None:
        self._update_timer_labels()
        logs = self.storage.data["break_tracker"].get("logs", [])
        self.break_count_label.setText(f"今日休息打卡紀錄 (已完成 {len(logs)} 次)")

        while self.break_list_layout.count():
            child = self.break_list_layout.takeAt(0)
            w = child.widget()
            if w is not None:
                w.setParent(None)
                w.deleteLater()

        if not logs:
            empty_lbl = QLabel("今天還沒有休息打卡紀錄，工作滿 1 小時記得起來動一動喔！")
            empty_lbl.setStyleSheet("font-size: 13px; color: #8E8E93; padding: 12px 0;")
            empty_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.break_list_layout.addWidget(empty_lbl)
        else:
            for idx, item in enumerate(logs):
                order_num = len(logs) - idx
                row = QFrame()
                row.setStyleSheet("QFrame { background-color: #F9F9FB; border-radius: 8px; }")
                r_layout = QHBoxLayout(row)
                r_layout.setContentsMargins(12, 8, 12, 8)

                badge = QLabel(f"第 {order_num} 次休息")
                badge.setStyleSheet(
                    """
                    background-color: #E8F8EE;
                    color: #28CD41;
                    border-radius: 6px;
                    padding: 2px 8px;
                    font-size: 12px;
                    font-weight: 700;
                    """
                )
                t_lbl = QLabel(f"打卡時間：{item['time']}")
                t_lbl.setStyleSheet("font-size: 13px; color: #1D1D1F; font-weight: 600;")
                note_lbl = QLabel(item.get("note", "休息 10 分鐘"))
                note_lbl.setStyleSheet("font-size: 12.5px; color: #6E6E73;")

                r_layout.addWidget(badge)
                r_layout.addSpacing(8)
                r_layout.addWidget(t_lbl)
                r_layout.addStretch()
                r_layout.addWidget(note_lbl)
                self.break_list_layout.addWidget(row)
            self.break_list_layout.addStretch()


# ============================================================================
# 9. 頁籤三：待辦事項 (TodoTab — 低/中/高下拉選單配色修正、打勾勾框、支援選擇日期)
# ============================================================================

class TodoTab(QWidget):
    """
    頁籤 3：待辦事項功能
    - 程度分為：高 (High)、中 (Medium)、低 (Low)
    - 支援選擇日期 (AppleDateButton + AppleCalendarDialog)
    - 完成框採用帶清晰白色『打勾勾 (✓)』的 AppleCheckBox
    """

    PRIORITY_META = {
        "high": {"label": "高優先", "fg": "#FF3B30", "bg": "#FFEBEA", "rank": 0},
        "medium": {"label": "中優先", "fg": "#FF9500", "bg": "#FFF4E5", "rank": 1},
        "low": {"label": "低優先", "fg": "#007AFF", "bg": "#E5F1FF", "rank": 2},
    }

    def __init__(self, storage: StorageManager, on_count_changed=None, parent: QWidget | None = None):
        super().__init__(parent)
        self.storage = storage
        self.on_count_changed = on_count_changed
        self.current_filter = "all"
        self.current_date_filter = "all"

        self._build_ui()
        self.refresh_ui()

    def _make_card(self) -> QFrame:
        card = QFrame()
        card.setObjectName("AppleCard")
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(22)
        shadow.setOffset(0, 4)
        shadow.setColor(QColor(0, 0, 0, 14))
        card.setGraphicsEffect(shadow)
        return card

    def _build_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 8, 0, 0)
        main_layout.setSpacing(16)

        # --- 卡片 1：新增待辦事項列 (含內容、日期選擇、程度選擇) ---
        add_card = self._make_card()
        a_layout = QVBoxLayout(add_card)
        a_layout.setContentsMargins(24, 18, 24, 18)
        a_layout.setSpacing(12)

        top_title = QHBoxLayout()
        icon_lbl = QLabel()
        icon_lbl.setPixmap(SvgIcons.pixmap(SvgIcons.CHECKLIST, "#FF9500", 22))
        t_lbl = QLabel("新增待辦事項")
        t_lbl.setStyleSheet("font-size: 17px; font-weight: 700; color: #1D1D1F;")
        top_title.addWidget(icon_lbl)
        top_title.addWidget(t_lbl)
        top_title.addStretch()
        a_layout.addLayout(top_title)

        input_row = QHBoxLayout()
        input_row.setSpacing(10)

        self.todo_input = QLineEdit()
        self.todo_input.setPlaceholderText("輸入待辦事項內容（按 Enter 或點擊右側新增）...")
        self.todo_input.setFixedHeight(42)
        self.todo_input.setStyleSheet(
            """
            QLineEdit {
                background-color: #F5F5F7;
                border: 1.5px solid #E5E5EA;
                border-radius: 10px;
                padding: 0 14px;
                font-size: 14px;
                color: #1D1D1F;
            }
            QLineEdit:focus {
                background-color: #FFFFFF;
                border: 1.5px solid #007AFF;
            }
            """
        )
        self.todo_input.returnPressed.connect(self.add_todo)

        # 日期選擇按鈕 (預設今日，點擊跳出日曆)
        self.date_picker_btn = AppleDateButton(date.today().isoformat(), height=42, parent=self)

        # 修正配色與外觀的 Apple 風格優先程度下拉選單
        self.priority_select = PrioritySelector(self)
        self.priority_select.setFixedHeight(42)
        self.priority_select.setFixedWidth(144)
        self.priority_select.setCurrentIndex(1)  # 預設中程度

        add_btn = QPushButton("＋ 新增待辦")
        add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_btn.setFixedHeight(42)
        add_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #007AFF;
                color: #FFFFFF;
                border: none;
                border-radius: 10px;
                padding: 0 20px;
                font-size: 14px;
                font-weight: 700;
            }
            QPushButton:hover { background-color: #0062CC; }
            """
        )
        add_btn.clicked.connect(self.add_todo)

        input_row.addWidget(self.todo_input, 1)
        input_row.addWidget(self.date_picker_btn)
        input_row.addWidget(self.priority_select)
        input_row.addWidget(add_btn)
        a_layout.addLayout(input_row)
        main_layout.addWidget(add_card)

        # --- 卡片 2：篩選器 + 待辦事項列表 ---
        list_card = self._make_card()
        l_layout = QVBoxLayout(list_card)
        l_layout.setContentsMargins(24, 18, 24, 18)
        l_layout.setSpacing(12)

        filter_row = QHBoxLayout()
        filter_row.setSpacing(6)
        self.filter_group = QButtonGroup(self)
        self.filter_group.setExclusive(True)

        filters = [
            ("all", "全部"),
            ("high", "高程度"),
            ("medium", "中程度"),
            ("low", "低程度"),
            ("active", "未完成"),
            ("completed", "已完成"),
        ]
        for key, text in filters:
            f_btn = QPushButton(text)
            f_btn.setCheckable(True)
            f_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            f_btn.setFixedHeight(32)
            if key == "all":
                f_btn.setChecked(True)
            f_btn.setStyleSheet(
                """
                QPushButton {
                    background-color: #F2F2F7;
                    color: #515154;
                    border: none;
                    border-radius: 8px;
                    padding: 0 12px;
                    font-size: 12.5px;
                    font-weight: 600;
                }
                QPushButton:checked {
                    background-color: #1D1D1F;
                    color: #FFFFFF;
                }
                QPushButton:hover:!checked {
                    background-color: #E5E5EA;
                }
                """
            )
            f_btn.clicked.connect(lambda checked=False, fk=key: self.set_filter(fk))
            self.filter_group.addButton(f_btn)
            filter_row.addWidget(f_btn)

        filter_row.addSpacing(8)

        # 日期區間篩選按鈕組 (今日 / 一週內 / 全部日期)
        date_seg = QFrame()
        date_seg.setStyleSheet(
            """
            QFrame {
                background-color: #EFEFF4;
                border-radius: 9px;
                padding: 2px;
            }
            """
        )
        date_seg_layout = QHBoxLayout(date_seg)
        date_seg_layout.setContentsMargins(2, 2, 2, 2)
        date_seg_layout.setSpacing(2)

        self.date_filter_group = QButtonGroup(self)
        self.date_filter_group.setExclusive(True)

        date_filters = [
            ("today", "今日"),
            ("week", "一週內"),
            ("all", "全部日期"),
        ]
        for d_key, d_text in date_filters:
            d_btn = QPushButton(d_text)
            d_btn.setCheckable(True)
            d_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            d_btn.setFixedHeight(28)
            if d_key == "all":
                d_btn.setChecked(True)
            d_btn.setStyleSheet(
                """
                QPushButton {
                    background-color: transparent;
                    color: #515154;
                    border: none;
                    border-radius: 7px;
                    padding: 0 10px;
                    font-size: 12px;
                    font-weight: 700;
                }
                QPushButton:checked {
                    background-color: #007AFF;
                    color: #FFFFFF;
                }
                QPushButton:hover:!checked {
                    background-color: #E5E5EA;
                }
                """
            )
            d_btn.clicked.connect(lambda checked=False, dk=d_key: self.set_date_filter(dk))
            self.date_filter_group.addButton(d_btn)
            date_seg_layout.addWidget(d_btn)

        filter_row.addWidget(date_seg)
        filter_row.addStretch()
        self.summary_label = QLabel("0 項未完成")
        self.summary_label.setStyleSheet("font-size: 13px; color: #6E6E73; font-weight: 600;")
        filter_row.addWidget(self.summary_label)
        l_layout.addLayout(filter_row)

        self.todo_scroll = QScrollArea()
        self.todo_scroll.setWidgetResizable(True)
        self.todo_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.todo_scroll.setStyleSheet("QScrollArea { background: transparent; }")
        self.todo_container = QWidget()
        self.todo_container.setStyleSheet("background: transparent;")
        self.todo_list_layout = QVBoxLayout(self.todo_container)
        self.todo_list_layout.setContentsMargins(0, 4, 0, 4)
        self.todo_list_layout.setSpacing(8)
        self.todo_scroll.setWidget(self.todo_container)
        l_layout.addWidget(self.todo_scroll, 1)

        main_layout.addWidget(list_card, 1)

    def set_filter(self, filter_key: str) -> None:
        self.current_filter = filter_key
        self.refresh_ui()

    def set_date_filter(self, date_filter_key: str) -> None:
        self.current_date_filter = date_filter_key
        self.refresh_ui()

    def add_todo(self) -> None:
        title = self.todo_input.text().strip()
        if not title:
            return
        priority = self.priority_select.currentData()
        due_date = self.date_picker_btn.date_str()
        self.storage.data["todos"].insert(
            0,
            {
                "id": str(uuid.uuid4()),
                "title": title,
                "priority": priority,
                "due_date": due_date,
                "completed": False,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            },
        )
        self.todo_input.clear()
        self.storage.save()
        self.refresh_ui()

    def toggle_todo(self, todo_id: str, checked: bool) -> None:
        for item in self.storage.data["todos"]:
            if item.get("id") == todo_id:
                item["completed"] = bool(checked)
                break
        self.storage.save()
        self.refresh_ui()

    def edit_todo(self, todo_id: str) -> None:
        target = next((t for t in self.storage.data["todos"] if t.get("id") == todo_id), None)
        if not target:
            return
        dlg = EditTodoDialog(
            current_title=target.get("title", ""),
            current_priority=target.get("priority", "medium"),
            current_date_str=target.get("due_date", date.today().isoformat()),
            parent=self,
        )
        if dlg.exec() == QDialog.DialogCode.Accepted:
            new_title, new_priority, new_date = dlg.get_values()
            target["title"] = new_title
            target["priority"] = new_priority
            target["due_date"] = new_date
            self.storage.save()
            self.refresh_ui()

    def delete_todo(self, todo_id: str) -> None:
        self.storage.data["todos"] = [
            t for t in self.storage.data["todos"] if t.get("id") != todo_id
        ]
        self.storage.save()
        self.refresh_ui()

    def refresh_ui(self) -> None:
        todos = self.storage.data.get("todos", [])
        active_count = sum(1 for t in todos if not t.get("completed", False))
        self.summary_label.setText(f"共 {len(todos)} 項（{active_count} 項未完成）")
        if self.on_count_changed:
            self.on_count_changed(active_count)

        today_str = date.today().isoformat()
        week_end_str = (date.today() + timedelta(days=7)).isoformat()

        filtered = []
        for item in todos:
            if self.current_filter in ("high", "medium", "low") and item.get("priority") != self.current_filter:
                continue
            if self.current_filter == "active" and item.get("completed", False):
                continue
            if self.current_filter == "completed" and not item.get("completed", False):
                continue

            item_date = item.get("due_date") or today_str
            if self.current_date_filter == "today" and item_date != today_str:
                continue
            if self.current_date_filter == "week" and not (today_str <= item_date <= week_end_str):
                continue

            filtered.append(item)

        filtered.sort(
            key=lambda x: (
                1 if x.get("completed", False) else 0,
                self.PRIORITY_META.get(x.get("priority", "medium"), {"rank": 1})["rank"],
                x.get("due_date", "9999-99-99"),
            )
        )

        while self.todo_list_layout.count():
            child = self.todo_list_layout.takeAt(0)
            w = child.widget()
            if w is not None:
                w.setParent(None)
                w.deleteLater()

        if not filtered:
            empty_lbl = QLabel("目前此分類下沒有待辦事項 ✨")
            empty_lbl.setStyleSheet("font-size: 13.5px; color: #8E8E93; padding: 24px 0;")
            empty_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.todo_list_layout.addWidget(empty_lbl)
            return

        for item in filtered:
            row_frame = QFrame()
            is_done = bool(item.get("completed", False))
            row_frame.setStyleSheet(
                f"""
                QFrame {{
                    background-color: {'#F7F7FA' if is_done else '#FAFAFC'};
                    border: 1px solid #EBEBF0;
                    border-radius: 10px;
                }}
                """
            )
            r_layout = QHBoxLayout(row_frame)
            r_layout.setContentsMargins(14, 10, 14, 10)
            r_layout.setSpacing(10)

            tid = item["id"]
            # 使用帶清晰白色打勾勾 (✓) 的自繪 AppleCheckBox
            cb = AppleCheckBox(checked=is_done, parent=row_frame)
            cb.toggled.connect(lambda checked, item_id=tid: self.toggle_todo(item_id, checked))

            p_key = item.get("priority", "medium")
            p_meta = self.PRIORITY_META.get(p_key, self.PRIORITY_META["medium"])
            badge = QLabel(p_meta["label"])
            badge.setFixedWidth(58)
            badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
            badge.setStyleSheet(
                f"""
                QLabel {{
                    background-color: {p_meta['bg']};
                    color: {p_meta['fg']};
                    border-radius: 9px;
                    padding: 3px 6px;
                    font-size: 12px;
                    font-weight: 700;
                    border: none;
                }}
                """
            )

            title_lbl = QLabel(item.get("title", ""))
            title_lbl.setWordWrap(True)
            font = title_lbl.font()
            font.setStrikeOut(is_done)
            title_lbl.setFont(font)
            title_lbl.setStyleSheet(
                f"font-size: 14px; font-weight: 600; color: {'#8E8E93' if is_done else '#1D1D1F'}; border: none;"
            )

            # 顯示待辦事項日期標籤
            due_str = item.get("due_date") or date.today().isoformat()
            date_badge = QLabel(f"📅 {due_str}")
            date_badge.setStyleSheet(
                """
                QLabel {
                    background-color: #F2F2F7;
                    color: #6E6E73;
                    border-radius: 7px;
                    padding: 3px 8px;
                    font-size: 12px;
                    font-weight: 600;
                    border: none;
                }
                """
            )

            edit_btn = QPushButton("修改")
            edit_btn.setIcon(SvgIcons.icon(SvgIcons.EDIT, "#007AFF", 15))
            edit_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            edit_btn.setFixedHeight(28)
            edit_btn.setStyleSheet(
                """
                QPushButton {
                    background-color: #EBF4FF;
                    color: #007AFF;
                    border: none;
                    border-radius: 7px;
                    padding: 0 10px;
                    font-size: 12px;
                    font-weight: 600;
                }
                QPushButton:hover { background-color: #D6E9FF; }
                """
            )
            edit_btn.clicked.connect(lambda checked=False, item_id=tid: self.edit_todo(item_id))

            del_btn = QPushButton("刪除")
            del_btn.setIcon(SvgIcons.icon(SvgIcons.TRASH, "#FF3B30", 15))
            del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            del_btn.setFixedHeight(28)
            del_btn.setStyleSheet(
                """
                QPushButton {
                    background-color: #FFEBEA;
                    color: #FF3B30;
                    border: none;
                    border-radius: 7px;
                    padding: 0 10px;
                    font-size: 12px;
                    font-weight: 600;
                }
                QPushButton:hover { background-color: #FFD5D2; }
                """
            )
            del_btn.clicked.connect(lambda checked=False, item_id=tid: self.delete_todo(item_id))

            r_layout.addWidget(cb)
            r_layout.addWidget(badge)
            r_layout.addWidget(title_lbl, 1)
            r_layout.addWidget(date_badge)
            r_layout.addWidget(edit_btn)
            r_layout.addWidget(del_btn)
            self.todo_list_layout.addWidget(row_frame)

        self.todo_list_layout.addStretch()


# ============================================================================
# 10. 主視窗與系統工作列整合 (MainWindow)
# ============================================================================

class DailyAssistantWindow(QMainWindow):
    """多功能小幫手主視窗 (整合三頁籤、背景計時與 Windows 系統通知)。"""

    def __init__(self, storage: StorageManager | None = None):
        super().__init__()
        self.storage = storage or StorageManager()

        self.setWindowTitle("多功能小幫手")
        self.setMinimumSize(900, 630)
        self.resize(920, 650)
        self.setWindowIcon(SvgIcons.icon(SvgIcons.ASSISTANT_LOGO, size=64))

        self.setStyleSheet(
            """
            QMainWindow {
                background-color: #F5F5F7;
            }
            QFrame#AppleCard {
                background-color: #FFFFFF;
                border: 1px solid #E5E5EA;
                border-radius: 16px;
            }
            """
        )

        self._setup_tray()
        self._build_ui()

        self.master_timer = QTimer(self)
        self.master_timer.setInterval(1000)
        self.master_timer.timeout.connect(self._on_tick)
        self.master_timer.start()

    def _setup_tray(self) -> None:
        self.tray_icon = QSystemTrayIcon(self)
        self.tray_icon.setIcon(SvgIcons.icon(SvgIcons.ASSISTANT_LOGO, size=64))
        self.tray_icon.setToolTip("多功能小幫手 (喝水 / 休息 / 待辦)")

        tray_menu = QMenu(self)
        show_action = QAction("顯示主視窗", self)
        show_action.triggered.connect(self.showNormal)
        quit_action = QAction("結束應用程式", self)
        quit_action.triggered.connect(QApplication.instance().quit)
        tray_menu.addAction(show_action)
        tray_menu.addSeparator()
        tray_menu.addAction(quit_action)

        self.tray_icon.setContextMenu(tray_menu)
        self.tray_icon.activated.connect(self._on_tray_activated)
        self.tray_icon.show()

    def _on_tray_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.showNormal()
            self.activateWindow()

    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        root_layout = QVBoxLayout(central)
        root_layout.setContentsMargins(26, 20, 26, 20)
        root_layout.setSpacing(12)

        header_row = QHBoxLayout()
        header_row.setSpacing(10)

        brand_logo = QLabel()
        brand_logo.setPixmap(SvgIcons.pixmap(SvgIcons.ASSISTANT_LOGO, size=30))
        app_title = QLabel("多功能小幫手")
        app_title.setStyleSheet("font-size: 20px; font-weight: 800; color: #1D1D1F;")
        header_row.addWidget(brand_logo)
        header_row.addWidget(app_title)
        header_row.addStretch()

        seg_frame = QFrame()
        seg_frame.setStyleSheet(
            """
            QFrame {
                background-color: #E5E5EA;
                border-radius: 12px;
            }
            """
        )
        seg_layout = QHBoxLayout(seg_frame)
        seg_layout.setContentsMargins(5, 5, 5, 5)
        seg_layout.setSpacing(6)

        self.tab_group = QButtonGroup(self)
        self.tab_group.setExclusive(True)

        self.btn_tab_water = QPushButton(" 幫自己澆水")
        self.btn_tab_water.setIcon(SvgIcons.icon(SvgIcons.WATER_DROP, "#007AFF", 17))
        self.btn_tab_break = QPushButton(" 大腦放風")
        self.btn_tab_break.setIcon(SvgIcons.icon(SvgIcons.COFFEE_BREAK, "#34C759", 17))
        self.btn_tab_todo = QPushButton(" 打怪清單")
        self.btn_tab_todo.setIcon(SvgIcons.icon(SvgIcons.CHECKLIST, "#FF9500", 17))

        for idx, btn in enumerate((self.btn_tab_water, self.btn_tab_break, self.btn_tab_todo)):
            btn.setCheckable(True)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setFixedHeight(36)
            btn.setStyleSheet(
                """
                QPushButton {
                    background-color: transparent;
                    color: #515154;
                    border: none;
                    border-radius: 9px;
                    padding: 0 18px;
                    font-size: 14px;
                    font-weight: 700;
                }
                QPushButton:checked {
                    background-color: #FFFFFF;
                    color: #1D1D1F;
                }
                """
            )
            if idx == 0:
                btn.setChecked(True)
            self.tab_group.addButton(btn, idx)
            seg_layout.addWidget(btn)

        self.tab_group.idClicked.connect(self.switch_tab)
        header_row.addWidget(seg_frame)
        header_row.addStretch()

        # 右側放大版今日日期圓角卡片，方便隨時清楚查看
        date_badge_frame = QFrame()
        date_badge_frame.setStyleSheet(
            """
            QFrame {
                background-color: #FFFFFF;
                border: 1.5px solid #E5E5EA;
                border-radius: 11px;
            }
            """
        )
        date_badge_layout = QHBoxLayout(date_badge_frame)
        date_badge_layout.setContentsMargins(12, 6, 14, 6)
        date_badge_layout.setSpacing(7)

        cal_icon_lbl = QLabel()
        cal_icon_lbl.setPixmap(SvgIcons.pixmap(SvgIcons.CALENDAR, "#007AFF", 19))
        cal_icon_lbl.setStyleSheet("border: none; background: transparent;")
        self.date_label = QLabel(f"今日日期：{date.today().isoformat()}")
        self.date_label.setStyleSheet(
            "font-size: 15px; color: #1D1D1F; font-weight: 800; border: none; background: transparent;"
        )
        date_badge_layout.addWidget(cal_icon_lbl)
        date_badge_layout.addWidget(self.date_label)
        header_row.addWidget(date_badge_frame)

        root_layout.addLayout(header_row)

        self.stack = QStackedWidget()
        self.water_tab = WaterTab(self.storage, self.dispatch_notification, self)
        self.break_tab = BreakTab(self.storage, self.dispatch_notification, self)
        self.todo_tab = TodoTab(self.storage, self._update_todo_tab_badge, self)

        self.stack.addWidget(self.water_tab)
        self.stack.addWidget(self.break_tab)
        self.stack.addWidget(self.todo_tab)
        root_layout.addWidget(self.stack, 1)

        # 視窗右下角版本號：浮動放置於原本的視窗邊界內，完全不增加底部高度與 Layout 間距
        self.ver_lbl = QLabel(f"v{APP_VERSION}", central)
        self.ver_lbl.setStyleSheet("font-size: 11px; font-weight: 500; color: #8E8E93; background: transparent;")
        self.ver_lbl.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)

    def _update_todo_tab_badge(self, active_count: int) -> None:
        if active_count > 0:
            self.btn_tab_todo.setText(f" 打怪清單 ({active_count})")
        else:
            self.btn_tab_todo.setText(" 打怪清單")

    def switch_tab(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        btn = self.tab_group.button(index)
        if btn and not btn.isChecked():
            btn.setChecked(True)

    def dispatch_notification(
        self,
        title: str,
        message: str,
        primary_btn_text: str,
        icon_svg: str,
        accent_color: str,
        on_accept=None,
    ) -> None:
        if self.tray_icon.isSystemTrayAvailable():
            self.tray_icon.showMessage(
                title,
                message,
                QSystemTrayIcon.MessageIcon.Information,
                6000,
            )

        dlg = ReminderDialog(
            title=title,
            message=message,
            primary_btn_text=primary_btn_text,
            icon_svg=icon_svg,
            accent_color=accent_color,
            parent=self,
        )
        if dlg.exec() == QDialog.DialogCode.Accepted and on_accept is not None:
            on_accept()

    def _on_tick(self) -> None:
        if self.storage.check_daily_reset():
            self.date_label.setText(f"今日日期：{date.today().isoformat()}")
            self.water_tab.refresh_ui(animate=False)
            self.break_tab.refresh_ui()

        self.water_tab.tick_second()
        self.break_tab.tick_second()

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if hasattr(self, "ver_lbl") and self.centralWidget():
            self.ver_lbl.adjustSize()
            cw = self.centralWidget()
            self.ver_lbl.move(
                cw.width() - self.ver_lbl.width() - 26,
                cw.height() - self.ver_lbl.height() - 4,
            )
            self.ver_lbl.raise_()


def main() -> None:
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("vibe.multi.assistant.app.v2")
    except Exception:
        pass

    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    app.setApplicationName("多功能小幫手")
    app.setWindowIcon(SvgIcons.icon(SvgIcons.ASSISTANT_LOGO, size=64))
    font = QFont("Microsoft JhengHei UI", 10)
    app.setFont(font)

    window = DailyAssistantWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
