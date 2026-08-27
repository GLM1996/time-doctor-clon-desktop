import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_API_URL, resolveApiBaseUrl } from '../src/main/services/apiBaseUrl.js';

test('installed builds require HTTPS API transport', () => {
  assert.equal(resolveApiBaseUrl('http://backend.logyourtime.com/api', { isPackaged: true }), DEFAULT_API_URL);
  assert.equal(resolveApiBaseUrl('https://api.example.com/api/', { isPackaged: true }), 'https://api.example.com/api');
});

test('development permits HTTP only for loopback hosts', () => {
  assert.equal(resolveApiBaseUrl('http://localhost:3000/api', { isPackaged: false }), 'http://localhost:3000/api');
  assert.equal(resolveApiBaseUrl('http://192.168.1.20:3000/api', { isPackaged: false }), DEFAULT_API_URL);
});

test('credentials and malformed API URLs fall back safely', () => {
  assert.equal(resolveApiBaseUrl('https://user:password@example.com/api'), DEFAULT_API_URL);
  assert.equal(resolveApiBaseUrl('not-a-url'), DEFAULT_API_URL);
});
