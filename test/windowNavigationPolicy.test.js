import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  isAllowedExternalUrl,
  isAllowedRendererNavigation,
} from '../src/main/windowNavigationPolicy.js';

test('only opens trusted LogYourTime web destinations externally', () => {
  assert.equal(isAllowedExternalUrl('https://logyourtime.com/help'), true);
  assert.equal(isAllowedExternalUrl('https://www.logyourtime.com/privacy'), true);
  assert.equal(isAllowedExternalUrl('mailto:support@logyourtime.com'), true);
  assert.equal(isAllowedExternalUrl('mailto:attacker@example.com'), false);
  assert.equal(isAllowedExternalUrl('mailto:support@logyourtime.com?body=untrusted'), false);
  assert.equal(isAllowedExternalUrl('https://logyourtime.com.evil.example'), false);
  assert.equal(isAllowedExternalUrl('http://logyourtime.com'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
});

test('development navigation compares the complete origin', () => {
  const options = {
    isDev: true,
    rendererDevUrl: 'http://localhost:5173',
  };

  assert.equal(isAllowedRendererNavigation('http://localhost:5173/settings', options), true);
  assert.equal(isAllowedRendererNavigation('http://localhost:5173.evil.example', options), false);
  assert.equal(isAllowedRendererNavigation('http://localhost:5174', options), false);
});

test('production navigation is restricted to the packaged renderer file', () => {
  const rendererFile = path.resolve('out/renderer/index.html');
  const options = { rendererFile };

  assert.equal(isAllowedRendererNavigation(pathToFileURL(rendererFile).href, options), true);
  assert.equal(
    isAllowedRendererNavigation(pathToFileURL(path.resolve('other.html')).href, options),
    false,
  );
  assert.equal(isAllowedRendererNavigation('https://logyourtime.com', options), false);
});
