// ==UserScript==
// @name         YouTube Liquid Glass Speed Control
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Transparent, "Liquid Glass" style speed control for YouTube
// @author       Randun Labz
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Script created by Randun Labz

    const CONFIG = {
        step: 0.25,
        minSpeed: 0.25,
        maxSpeed: 8.0,
        storageKey: 'yt_speed_liquid_pref'
    };

    // --- CSS: Apple "Liquid Glass" Aesthetic ---
    const style = document.createElement('style');
    style.textContent = `
        /* 1. The Glass Panel */
        #yt-speed-panel {
            position: absolute;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 6000;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
            padding: 14px 8px;
            
            /* The "Liquid Glass" Effect */
            background: rgba(30, 30, 30, 0.2); /* Extremely transparent dark tint */
            backdrop-filter: blur(20px) saturate(180%); /* Heavy blur + vibrancy */
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-radius: 40px; /* Smooth pill shape */
            border: 1px solid rgba(255, 255, 255, 0.12); /* Subtle frost border */
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.15); /* Soft depth shadow */
            
            /* Animations */
            opacity: 1;
            transition: opacity 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), transform 0.3s;
            pointer-events: auto;
        }

        /* 2. Auto-Hide Logic */
        .html5-video-player.ytp-autohide #yt-speed-panel {
            opacity: 0;
            transform: translateY(-50%) scale(0.92); /* Shrink slightly when hiding */
            pointer-events: none;
        }

        /* 3. Circular Glass Buttons */
        .speed-v-btn {
            width: 38px;
            height: 38px;
            background: rgba(255, 255, 255, 0.05); /* Faint fill */
            color: #fff;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            font-weight: 400;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            transition: all 0.2s ease;
            user-select: none;
            border: 1px solid transparent; /* Placeholder for hover border */
        }

        .speed-v-btn:hover {
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.3);
            box-shadow: 0 0 15px rgba(255, 255, 255, 0.1); /* Inner glow */
            transform: scale(1.05);
        }

        .speed-v-btn:active {
            background: rgba(255, 255, 255, 0.3);
            transform: scale(0.95);
        }

        /* 4. Text Display */
        #speed-v-display {
            color: rgba(255, 255, 255, 0.9);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            font-weight: 600;
            text-align: center;
            letter-spacing: 0.5px;
            padding: 6px 0;
            pointer-events: none;
            text-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        /* 5. Preset Pills (1x, 2x) */
        .speed-preset {
            width: 38px;
            height: 22px;
            border-radius: 12px;
            font-size: 11px;
            background: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.7);
        }
        .speed-preset:hover {
            background: rgba(255, 255, 255, 0.25);
            color: #fff;
        }

        /* 6. Subtle Divider */
        .speed-divider {
            width: 16px;
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
            margin: 4px 0;
        }
    `;
    document.head.appendChild(style);

    let currentVideo = null;

    function createOverlay() {
        const container = document.createElement('div');
        container.id = 'yt-speed-panel';

        // Button Creator
        const createBtn = (text, action, isPreset = false) => {
            const btn = document.createElement('div');
            btn.className = isPreset ? 'speed-v-btn speed-preset' : 'speed-v-btn';
            btn.textContent = text;
            btn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                action();
            };
            return btn;
        };

        // --- Layout ---
        
        // Top: Increase
        container.appendChild(createBtn('+', () => changeSpeed(CONFIG.step)));

        // Middle: Text
        const display = document.createElement('div');
        display.id = 'speed-v-display';
        display.textContent = '1.0x';
        container.appendChild(display);

        // Bottom: Decrease
        container.appendChild(createBtn('−', () => changeSpeed(-CONFIG.step)));

        // Divider
        const divider = document.createElement('div');
        divider.className = 'speed-divider';
        container.appendChild(divider);

        // Presets
        container.appendChild(createBtn('1x', () => setSpeed(1.0), true));
        container.appendChild(createBtn('2x', () => setSpeed(2.0), true));

        return container;
    }

    function changeSpeed(delta) {
        if (!currentVideo) return;
        let newSpeed = currentVideo.playbackRate + delta;
        newSpeed = Math.round(newSpeed * 100) / 100;
        setSpeed(newSpeed);
    }

    function setSpeed(speed) {
        if (!currentVideo) return;
        if (speed < CONFIG.minSpeed) speed = CONFIG.minSpeed;
        if (speed > CONFIG.maxSpeed) speed = CONFIG.maxSpeed;

        currentVideo.playbackRate = speed;
        updateDisplay(speed);
        localStorage.setItem(CONFIG.storageKey, speed);
    }

    function updateDisplay(speed) {
        const display = document.querySelector('#speed-v-display');
        if (display) display.textContent = speed + 'x';
    }

    function init() {
        const player = document.querySelector('#movie_player'); 
        const video = document.querySelector('video');

        if (player && video) {
            currentVideo = video;

            if (!document.querySelector('#yt-speed-panel')) {
                player.appendChild(createOverlay());
                
                const saved = parseFloat(localStorage.getItem(CONFIG.storageKey));
                if (saved) {
                    setTimeout(() => setSpeed(saved), 500);
                }
            }

            video.addEventListener('ratechange', () => {
                const spd = Math.round(video.playbackRate * 100) / 100;
                updateDisplay(spd);
            });
        }
    }

    setInterval(init, 1000);

})();