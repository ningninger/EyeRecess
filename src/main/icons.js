'use strict';
const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');

const ASSETS = path.join(__dirname, '../../assets');

function readPng(name) {
  try {
    return fs.readFileSync(path.join(ASSETS, name));
  } catch {
    return null;
  }
}

function multi(oneX, twoX) {
  const a = readPng(oneX);
  const b = readPng(twoX);
  if (!a) return nativeImage.createEmpty();
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, buffer: a });
  if (b) img.addRepresentation({ scaleFactor: 2, buffer: b });
  return img;
}

const cache = new Map();

/** state: 'idle' | 'due' | 'rest' */
function trayImage(state) {
  if (process.platform === 'darwin') {
    const file =
      state === 'due' ? 'trayTemplate-due' : state === 'rest' ? 'trayTemplate-rest' : 'trayTemplate';
    const key = 'tpl:' + file;
    if (!cache.has(key)) {
      const img = nativeImage.createFromPath(path.join(ASSETS, `${file}.png`));
      if (!img.isEmpty()) img.setTemplateImage(true);
      cache.set(key, img);
    }
    return cache.get(key);
  }
  const suffix = state === 'due' ? 'due' : state === 'rest' ? 'rest' : 'idle';
  const key = 'color:' + suffix;
  if (!cache.has(key)) {
    cache.set(key, multi(`tray-${suffix}.png`, `tray-${suffix}@2x.png`));
  }
  return cache.get(key);
}

function appIcon() {
  return nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
}

module.exports = { trayImage, appIcon, ASSETS };
