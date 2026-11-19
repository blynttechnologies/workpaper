import { describe, it, expect } from 'vitest';
import { onNewBuild } from '@/components/layout/NewVersionWatch';

const idle = { loaded: 'A', live: 'B', unsaved: false, busy: false, reloadedFor: '', asked: false };

describe('reloading an open page when a new version is deployed', () => {
  it('does nothing while the live build is the one the page loaded from, or is not known', () => {
    expect(onNewBuild({ ...idle, live: 'A' })).toBe('nothing');
    expect(onNewBuild({ ...idle, live: '' })).toBe('nothing');
    expect(onNewBuild({ ...idle, loaded: '' })).toBe('nothing');
  });

  it('reloads by itself when nothing is unsaved and the page is not being used', () => {
    expect(onNewBuild(idle)).toBe('reload');
  });

  it('never reloads over an unsaved edit, even when Reload was clicked', () => {
    expect(onNewBuild({ ...idle, unsaved: true })).toBe('banner');
    expect(onNewBuild({ ...idle, unsaved: true, asked: true })).toBe('banner');
  });

  it('waits with a note while the page is being used, and reloads at once when asked', () => {
    expect(onNewBuild({ ...idle, busy: true })).toBe('banner');
    expect(onNewBuild({ ...idle, busy: true, asked: true })).toBe('reload');
  });

  it('reloads by itself only once for a build, so an old server answering mid-deploy cannot loop it', () => {
    expect(onNewBuild({ ...idle, reloadedFor: 'B' })).toBe('banner');
    expect(onNewBuild({ ...idle, reloadedFor: 'B', asked: true })).toBe('reload');
    expect(onNewBuild({ ...idle, live: 'C', reloadedFor: 'B' })).toBe('reload');
  });
});
