// 台北捷運路線資料
const mrtLines = {
    'BL': { 
        name: '板南線', 
        color: '#0070BD', 
        maxStations: 23,
        stations: {
            '01': '頂埔', '02': '永寧', '03': '土城', '04': '海山', '05': '亞東醫院',
            '06': '府中', '07': '板橋', '08': '新埔', '09': '江子翠', '10': '龍山寺',
            '11': '西門', '12': '台北車站', '13': '善導寺', '14': '忠孝新生', '15': '忠孝復興',
            '16': '忠孝敦化', '17': '國父紀念館', '18': '市政府', '19': '永春', '20': '後山埤',
            '21': '昆陽', '22': '南港', '23': '南港展覽館'
        }
    },
    'R': { 
        name: '淡水信義線', 
        color: '#E3002C', 
        maxStations: 28,
        stations: {
            '01': '淡水', '02': '紅樹林', '03': '竹圍', '04': '關渡', '05': '忠義',
            '06': '復興崗', '07': '新北投', '08': '北投', '09': '奇岩', '10': '唭哩岸',
            '11': '石牌', '12': '明德', '13': '芝山', '14': '士林', '15': '劍潭',
            '16': '圓山', '17': '民權西路', '18': '雙連', '19': '中山', '20': '台北車站',
            '21': '台大醫院', '22': '中正紀念堂', '23': '東門', '24': '大安森林公園', '25': '大安',
            '26': '信義安和', '27': '台北101/世貿', '28': '象山'
        }
    },
    'G': { 
        name: '松山新店線', 
        color: '#008659', 
        maxStations: 19,
        stations: {
            '01': '新店', '02': '新店區公所', '03': '七張', '04': '大坪林', '05': '景美',
            '06': '萬隆', '07': '公館', '08': '台電大樓', '09': '古亭', '10': '中正紀念堂',
            '11': '小南門', '12': '西門', '13': '北門', '14': '中山', '15': '松江南京',
            '16': '南京復興', '17': '台北小巨蛋', '18': '南京三民', '19': '松山'
        }
    },
    'O': { 
        name: '中和新蘆線', 
        color: '#F8B61C', 
        maxStations: 26,
        stations: {
            '01': '蘆洲', '02': '三民高中', '03': '徐匯中學', '04': '三和國中', '05': '三重國小',
            '06': '菜寮', '07': '台北橋', '08': '大橋頭', '09': '民權西路', '10': '大橋頭',
            '11': '台北橋', '12': '菜寮', '13': '三重國小', '14': '三和國中', '15': '徐匯中學',
            '16': '三民高中', '17': '蘆洲', '18': '三重', '19': '新莊', '20': '輔大',
            '21': '丹鳳', '22': '迴龍', '23': '頂溪', '24': '永安市場', '25': '景安', '26': '南勢角'
        }
    },
    'BR': { 
        name: '文湖線', 
        color: '#C48C31', 
        maxStations: 24,
        stations: {
            '01': '動物園', '02': '木柵', '03': '萬芳社區', '04': '萬芳醫院', '05': '辛亥',
            '06': '麟光', '07': '六張犁', '08': '科技大樓', '09': '大安', '10': '忠孝復興',
            '11': '忠孝敦化', '12': '國父紀念館', '13': '市政府', '14': '永春', '15': '後山埤',
            '16': '昆陽', '17': '南港', '18': '南港展覽館', '19': '南港軟體園區', '20': '東湖',
            '21': '葫洲', '22': '大湖公園', '23': '內湖', '24': '文德'
        }
    },
    'Y': { 
        name: '環狀線', 
        color: '#FFD700', 
        maxStations: 14,
        stations: {
            '01': '大坪林', '02': '十四張', '03': '秀朗橋', '04': '景平', '05': '景安',
            '06': '中和', '07': '橋和', '08': '中原', '09': '板新', '10': '板橋',
            '11': '新埔民生', '12': '頭前庄', '13': '幸福', '14': '新北產業園區'
        }
    },
    'A': { 
        name: '機場捷運', 
        color: '#6B4E99', 
        maxStations: 22,
        stations: {
            '01': '台北車站', '02': '三重', '03': '新北產業園區', '04': '新莊副都心', '05': '泰山',
            '06': '泰山貴和', '07': '體育大學', '08': '長庚醫院', '09': '林口', '10': '山鼻',
            '11': '坑口', '12': '機場第一航廈', '13': '機場第二航廈', '14': '機場旅館', '15': '大園',
            '16': '橫山', '17': '領航', '18': '高鐵桃園站', '19': '桃園體育園區', '20': '興南',
            '21': '環北', '22': '中壢車站'
        }
    },
    'S': { 
        name: '新北投支線', 
        color: '#E3002C', 
        maxStations: 2,
        stations: {
            '01': '北投', '02': '新北投'
        }
    },
    'X': { 
        name: '小碧潭支線', 
        color: '#008659', 
        maxStations: 2,
        stations: {
            '01': '七張', '02': '小碧潭'
        }
    }
};

// DOM 元素
const lotteryDisplay = document.getElementById('lotteryDisplay');
const finalResult = document.getElementById('finalResult');
const lotteryBtn = document.getElementById('lotteryBtn');
const resetBtn = document.getElementById('resetBtn');
const clearBtn = document.getElementById('clearBtn');
const historyList = document.getElementById('historyList');

// 狀態變數
let isDrawing = false;
let drawHistory = [];

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    loadHistory();
    setupEventListeners();
});

// 設置事件監聽器
function setupEventListeners() {
    lotteryBtn.addEventListener('click', drawStation);
    resetBtn.addEventListener('click', resetLottery);
    clearBtn.addEventListener('click', clearHistory);
}

// 抽取捷運站
function drawStation() {
    if (isDrawing) return;
    
    isDrawing = true;
    lotteryBtn.disabled = true;
    lotteryDisplay.classList.add('active');
    
    // 動畫效果
    let counter = 0;
    const animation = setInterval(() => {
        const randomStation = getRandomStation();
        lotteryDisplay.innerHTML = `
            <div>
                <span style="color: ${randomStation.color}; font-size: 2rem;">${randomStation.code}</span>
                <div style="font-size: 1rem; margin-top: 5px;">${randomStation.stationName}</div>
            </div>
        `;
        counter++;
        
        if (counter > 25) {
            clearInterval(animation);
            lotteryDisplay.classList.remove('active');
            lotteryBtn.disabled = false;
            isDrawing = false;
            
            // 顯示最終結果
            showFinalResult(randomStation);
        }
    }, 80);
}

// 獲取隨機捷運站
function getRandomStation() {
    const lines = Object.keys(mrtLines);
    const randomLine = lines[Math.floor(Math.random() * lines.length)];
    const lineData = mrtLines[randomLine];
    const stationNumbers = Object.keys(lineData.stations);
    const randomStationNumber = stationNumbers[Math.floor(Math.random() * stationNumbers.length)];
    const stationName = lineData.stations[randomStationNumber];
    
    return {
        code: `${randomLine}${randomStationNumber}`,
        stationName: stationName,
        lineName: lineData.name,
        color: lineData.color,
        lineCode: randomLine,
        stationNumber: randomStationNumber
    };
}

// 顯示最終結果
function showFinalResult(station) {
    // 自動判斷字體顏色（根據背景色亮度）
    function getContrastYIQ(hexcolor) {
        hexcolor = hexcolor.replace('#', '');
        const r = parseInt(hexcolor.substr(0,2),16);
        const g = parseInt(hexcolor.substr(2,2),16);
        const b = parseInt(hexcolor.substr(4,2),16);
        const yiq = ((r*299)+(g*587)+(b*114))/1000;
        return (yiq >= 180) ? '#222' : '#fff';
    }
    const bgColor = station.color;
    const textColor = getContrastYIQ(bgColor);
    finalResult.innerHTML = `
        <div>
            <div style="font-size: 3rem; margin-bottom: 10px;">${station.code}</div>
            <div style="font-size: 1.5rem; margin-bottom: 5px; background: ${bgColor}; color: ${textColor}; padding: 8px 20px; border-radius: 10px; display: inline-block; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">${station.stationName}</div>
            <div style="font-size: 1rem; opacity: 0.8;">${station.lineName}</div>
        </div>
    `;
    
    // 添加到歷史記錄
    addToHistory(station);
}

// 重新開始
function resetLottery() {
    // 重置顯示
    lotteryDisplay.innerHTML = '<span class="placeholder">點擊抽籤按鈕開始</span>';
    finalResult.innerHTML = '<span class="placeholder">等待抽籤結果...</span>';
    
    // 重置按鈕
    lotteryBtn.disabled = false;
    
    // 移除動畫類
    lotteryDisplay.classList.remove('active');
}

// 添加到歷史記錄
function addToHistory(station) {
    const timestamp = new Date().toLocaleString('zh-TW');
    const historyItem = {
        result: station.code,
        stationName: station.stationName,
        lineName: station.lineName,
        timestamp: timestamp
    };
    
    drawHistory.unshift(historyItem);
    
    // 限制歷史記錄數量
    if (drawHistory.length > 10) {
        drawHistory = drawHistory.slice(0, 10);
    }
    
    saveHistory();
    updateHistoryDisplay();
}

// 更新歷史記錄顯示
function updateHistoryDisplay() {
    if (drawHistory.length === 0) {
        historyList.innerHTML = '<p class="no-history">尚無抽籤記錄</p>';
        return;
    }
    
    historyList.innerHTML = drawHistory.map(item => `
        <div class="history-item">
            <div class="result-info">
                <span class="result">${item.result}</span>
                <span class="station-name">${item.stationName || '未知站名'}</span>
                <span class="line-name">${item.lineName || '未知路線'}</span>
            </div>
            <span class="time">${item.timestamp}</span>
        </div>
    `).join('');
}

// 清除歷史記錄
function clearHistory() {
    if (confirm('確定要清除所有歷史記錄嗎？')) {
        drawHistory = [];
        saveHistory();
        updateHistoryDisplay();
    }
}

// 保存歷史記錄到本地存儲
function saveHistory() {
    localStorage.setItem('mrtLotteryHistory', JSON.stringify(drawHistory));
}

// 載入歷史記錄
function loadHistory() {
    const saved = localStorage.getItem('mrtLotteryHistory');
    if (saved) {
        drawHistory = JSON.parse(saved);
        updateHistoryDisplay();
    }
}

// 鍵盤快捷鍵
document.addEventListener('keydown', function(e) {
    if (e.key === ' ' && !lotteryBtn.disabled) {
        e.preventDefault();
        drawStation();
    } else if (e.key === 'r' || e.key === 'R') {
        resetLottery();
    } else if (e.key === 'c' || e.key === 'C') {
        clearHistory();
    }
}); 