class Timer {
    constructor() {
        this.minutesInput = document.getElementById('minutes-input');
        this.secondsInput = document.getElementById('seconds-input');
        this.startBtn = document.getElementById('start-btn');
        this.pauseBtn = document.getElementById('pause-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.timeDisplay = document.getElementById('time-display');
        this.circle = document.querySelector('.progress-ring__circle');
        this.setupControls = document.getElementById('setup-controls');

        this.radius = this.circle.r.baseVal.value;
        this.circumference = this.radius * 2 * Math.PI;

        this.circle.style.strokeDasharray = `${this.circumference} ${this.circumference}`;
        this.circle.style.strokeDashoffset = 0;

        this.totalSeconds = 0;
        this.remainingSeconds = 0;
        this.intervalId = null;
        this.isRunning = false;

        this.init();
    }

    init() {
        this.startBtn.addEventListener('click', () => this.start());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.resetBtn.addEventListener('click', () => this.reset());

        // Input validation
        [this.minutesInput, this.secondsInput].forEach(input => {
            input.addEventListener('change', () => {
                let val = parseInt(input.value);
                if (isNaN(val) || val < 0) input.value = "00";
                if (input.id === 'seconds-input' && val > 59) input.value = "59";
                if (val < 10 && val >= 0 && input.value.length < 2) input.value = "0" + val;
                this.updateDisplayFromInputs();
            });
        });

        this.updateDisplayFromInputs();
    }

    updateDisplayFromInputs() {
        const mins = this.minutesInput.value.toString().padStart(2, '0');
        const secs = this.secondsInput.value.toString().padStart(2, '0');
        this.timeDisplay.textContent = `${mins}:${secs}`;
    }

    setProgress(percent) {
        const offset = this.circumference - (percent / 100) * this.circumference;
        this.circle.style.strokeDashoffset = offset;
    }

    start() {
        if (!this.isRunning) {
            if (this.remainingSeconds === 0) {
                const mins = parseInt(this.minutesInput.value) || 0;
                const secs = parseInt(this.secondsInput.value) || 0;
                this.totalSeconds = mins * 60 + secs;
                this.remainingSeconds = this.totalSeconds;
            }

            if (this.totalSeconds === 0) return;

            this.isRunning = true;
            this.toggleControls(true);

            this.intervalId = setInterval(() => {
                this.remainingSeconds--;
                this.updateTimer();

                if (this.remainingSeconds <= 0) {
                    this.complete();
                }
            }, 1000);
        }
    }

    pause() {
        if (this.isRunning) {
            clearInterval(this.intervalId);
            this.isRunning = false;
            this.toggleControls(false);
            this.startBtn.textContent = "繼續";
        }
    }

    reset() {
        clearInterval(this.intervalId);
        this.isRunning = false;
        this.remainingSeconds = 0;
        this.totalSeconds = 0;
        this.toggleControls(false);
        this.startBtn.textContent = "開始";
        this.circle.style.strokeDashoffset = 0;
        this.updateDisplayFromInputs();

        // Reset inputs to default if needed, or keep last set
        // this.minutesInput.value = "05";
        // this.secondsInput.value = "00";
        // this.updateDisplayFromInputs();

        document.body.classList.remove('running-mode');
        this.setupControls.style.display = 'flex';
        this.timeDisplay.style.display = 'none';
    }

    updateTimer() {
        const mins = Math.floor(this.remainingSeconds / 60);
        const secs = this.remainingSeconds % 60;
        this.timeDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        const percent = (this.remainingSeconds / this.totalSeconds) * 100;
        this.setProgress(percent);
    }

    complete() {
        clearInterval(this.intervalId);
        this.isRunning = false;
        this.toggleControls(false);
        this.startBtn.textContent = "開始";
        this.remainingSeconds = 0;
        this.setProgress(0);

        // Play sound or animation
        alert("時間到！");
        this.reset();
    }

    toggleControls(running) {
        if (running) {
            this.startBtn.classList.add('hidden');
            this.pauseBtn.classList.remove('hidden');
            this.setupControls.style.display = 'none';
            this.timeDisplay.style.display = 'block';
            document.querySelector('.container').classList.add('timer-running');
        } else {
            this.startBtn.classList.remove('hidden');
            this.pauseBtn.classList.add('hidden');
            document.querySelector('.container').classList.remove('timer-running');
        }
    }

    complete() {
        clearInterval(this.intervalId);
        this.isRunning = false;
        this.toggleControls(false);
        this.startBtn.textContent = "開始";
        this.remainingSeconds = 0;
        this.setProgress(0);

        // Effects
        createConfetti();
        this.reset();
    }
}

// Particle System
class ParticleSystem {
    constructor() {
        this.canvas = document.getElementById('particle-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.resize();

        window.addEventListener('resize', () => this.resize());
        this.initParticles();
        this.animate();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    initParticles() {
        const particleCount = 50;
        for (let i = 0; i < particleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                size: Math.random() * 3 + 1,
                color: `rgba(${Math.random() > 0.5 ? '255, 0, 204' : '51, 51, 153'}, ${Math.random() * 0.5})`
            });
        }
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0 || p.x > this.canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > this.canvas.height) p.vy *= -1;

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fillStyle = p.color;
            this.ctx.fill();
        });

        requestAnimationFrame(() => this.animate());
    }
}

// Simple Confetti
function createConfetti() {
    const colors = ['#ff00cc', '#333399', '#ffffff', '#00ffff'];
    for (let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.top = -10 + 'px';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDuration = (Math.random() * 3 + 2) + 's';
        confetti.style.opacity = Math.random();
        document.body.appendChild(confetti);

        setTimeout(() => confetti.remove(), 5000);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new Timer();
    new ParticleSystem();
    // Initial state
    document.getElementById('time-display').style.display = 'none';
});
