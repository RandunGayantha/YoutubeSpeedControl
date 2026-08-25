// ==UserScript==
// @name         YouTube Liquid Glass Speed Control
// @namespace    https://github.com/RandunGayantha
// @version      1.1
// @description  A modern, transparent speed control overlay for YouTube with "Liquid Glass" aesthetics. Auto-hides with player controls. Persists speed across playlist videos, no listener leaks.
// @author       Randun Labz
// @license      MIT
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Script created by Randun Labz
    // v1.1 changelog:
    //  - Fixed: playlist "next video" not inheriting the speed you set (panel survived
    //    SPA navigation, so the old code skipped re-applying saved speed to the new
    //    <video> element).
    //  - Fixed: a fresh 'ratechange' listener was being stacked on the video every
    //    second forever -> hundreds of duplicate listeners over time -> the lag you saw.
    //    Listeners are now attached exactly once per video element.
    //  - Added: listens to YouTube's own 'yt-navigate-finish' SPA event so the panel
    //    reacts to video changes instantly instead of waiting on the next poll tick.
    //  - Lowered poll frequency since per-tick work is now cheap (no more DOM listener
    //    churn), which further reduces overhead.

    const CONFIG = {
        step: 0.25,
        minSpeed: 0.25,
        maxSpeed: 8.0,
        storageKey: 'yt_speed_liquid_pref',
        pollMs: 1500
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

    // Tracks the <video> element we're currently wired up to, so we can detect
    // when YouTube swaps in a new one (playlist advance, related video, etc.)
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

    function getSavedSpeed() {
        const saved = parseFloat(localStorage.getItem(CONFIG.storageKey));
        return isNaN(saved) ? null : saved;
    }

    // Named handler so we can recognize (and never double-attach) it per video element.
    function onRateChange(e) {
        const video = e.target;
        const spd = Math.round(video.playbackRate * 100) / 100;
        updateDisplay(spd);
    }

    function attachToVideo(video) {
        // Guard against attaching the ratechange listener more than once to the
        // same element — this is what was causing the growing lag.
        if (video.dataset.speedControlAttached === '1') return;
        video.addEventListener('ratechange', onRateChange);
        video.dataset.speedControlAttached = '1';
    }

    function init() {
        const player = document.querySelector('#movie_player');
        const video = document.querySelector('video');

        if (!player || !video) return;

        // Panel can survive SPA navigation (player container persists), so make
        // sure it exists without recreating it unnecessarily.
        if (!document.querySelector('#yt-speed-panel')) {
            player.appendChild(createOverlay());
        }

        // Video element changed (playlist advance, autoplay next, user clicked
        // another video) — this is the real signal we care about, not just
        // "does the panel exist".
        const videoChanged = video !== currentVideo;
        currentVideo = video;
        attachToVideo(video);

        if (videoChanged) {
            const saved = getSavedSpeed();
            if (saved) {
                // Slight delay so YouTube's own player init doesn't stomp on it.
                setTimeout(() => setSpeed(saved), 300);
            } else {
                updateDisplay(Math.round(video.playbackRate * 100) / 100);
            }
        }
    }

    // React instantly to YouTube's own SPA navigation event (fires on playlist
    // advance, clicking a related video, back/forward nav, etc.) instead of
    // waiting for the next poll tick.
    document.addEventListener('yt-navigate-finish', init);

    // Lightweight fallback poll — cheap now that init() no longer does DOM
    // listener churn every tick, just in case the nav event doesn't fire
    // (e.g. very first load).
    setInterval(init, CONFIG.pollMs);
    init();

})();
