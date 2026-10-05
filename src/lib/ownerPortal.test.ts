import { describe, expect, it } from 'vitest';
import { ownerAuthRedirectUrl, resolveOwnerPortalConfiguration } from './ownerPortal';

const approvedPortal = {
  configuredOrigin: 'https://portal.example.test',
  runtimeOrigin: 'https://portal.example.test',
  supabaseUrl: 'https://project.example.supabase.co',
  supabaseAnonKey: 'sb_publishable_test',
  allowLocalDevelopment: false,
};

describe('owner portal authentication boundary', () => {
  it('fails closed without one configured public owner origin', () => {
    expect(resolveOwnerPortalConfiguration({
      configuredOrigin: '',
      runtimeOrigin: 'https://portal.example.test',
      allowLocalDevelopment: false,
    })).toEqual({
      approvedOrigin: null,
      isReady: false,
      failure: 'MISSING_CONFIGURED_ORIGIN',
    });

    for (const configuredOrigin of [
      'http://portal.example.test',
      'https://portal.example.test/auth',
      'https://*.example.test',
      'https://portal.example.test?next=unsafe',
    ]) {
      expect(resolveOwnerPortalConfiguration({
        configuredOrigin,
        runtimeOrigin: 'https://portal.example.test',
        allowLocalDevelopment: false,
      })).toEqual({
        approvedOrigin: null,
        isReady: false,
        failure: 'INVALID_CONFIGURED_ORIGIN',
      });
    }
  });

  it('canonicalizes equivalent HTTPS root URLs without admitting paths or credentials', () => {
    for (const configuredOrigin of ['https://portal.example.test/', 'https://portal.example.test:443/']) {
      expect(resolveOwnerPortalConfiguration({...approvedPortal, configuredOrigin})).toMatchObject({approvedOrigin:'https://portal.example.test',isReady:true});
    }
    for (const configuredOrigin of ['https://user:pass@portal.example.test/', 'https://portal.example.test/#unsafe']) {
      expect(resolveOwnerPortalConfiguration({...approvedPortal, configuredOrigin}).isReady).toBe(false);
    }
  });

  it('does not collect credentials on a preview or unknown origin', () => {
    expect(resolveOwnerPortalConfiguration({
      ...approvedPortal,
      runtimeOrigin: 'https://preview.example.test',
    })).toEqual({
      approvedOrigin: 'https://portal.example.test',
      isReady: false,
      failure: 'UNAPPROVED_RUNTIME_ORIGIN',
    });
  });

  it('requires a real browser-safe Supabase configuration', () => {
    expect(resolveOwnerPortalConfiguration({
      ...approvedPortal,
      supabaseUrl: '',
    })).toEqual({
      approvedOrigin: 'https://portal.example.test',
      isReady: false,
      failure: 'MISSING_BROWSER_AUTH_CONFIGURATION',
    });

    expect(resolveOwnerPortalConfiguration({
      ...approvedPortal,
      supabaseAnonKey: 'sb_secret_not_for_browser',
    })).toEqual({
      approvedOrigin: 'https://portal.example.test',
      isReady: false,
      failure: 'INVALID_BROWSER_AUTH_CONFIGURATION',
    });

    expect(resolveOwnerPortalConfiguration({
      ...approvedPortal,
      supabaseAnonKey: 'e30.eyJyb2xlIjoiYW5vbiJ9.signature',
    })).toEqual({
      approvedOrigin: 'https://portal.example.test',
      isReady: true,
      failure: null,
    });
  });

  it('permits localhost only in an explicit development configuration', () => {
    expect(resolveOwnerPortalConfiguration({
      configuredOrigin: 'http://localhost:5173',
      runtimeOrigin: 'http://localhost:5173',
      supabaseUrl: 'http://localhost:54321',
      supabaseAnonKey: 'sb_publishable_local_test',
      allowLocalDevelopment: true,
    })).toEqual({
      approvedOrigin: 'http://localhost:5173',
      isReady: true,
      failure: null,
    });

    expect(resolveOwnerPortalConfiguration({
      configuredOrigin: 'http://localhost:5173',
      runtimeOrigin: 'http://localhost:5173',
      supabaseUrl: 'http://localhost:54321',
      supabaseAnonKey: 'sb_publishable_local_test',
      allowLocalDevelopment: false,
    }).isReady).toBe(false);
  });

  it('keeps signup confirmation distinct from password recovery', () => {
    expect(ownerAuthRedirectUrl('SIGNUP_CONFIRMATION', approvedPortal))
      .toBe('https://portal.example.test');
    expect(ownerAuthRedirectUrl('RECOVERY', approvedPortal))
      .toBe('https://portal.example.test?auth=recovery');
  });
});
