// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderRisks } from '../src/web/render';
import { attributionFrom } from '../src/web/analytics';

describe('safe rendering and attribution', () => {
  it('renders model output as text, never executable markup', () => {
    const root = document.createElement('section');
    renderRisks(root,{summary:'test',topRisks:[{title:'<img src=x onerror=alert(1)>',description:'<script>steal()</script>'}]});
    expect(root.querySelector('img,script')).toBeNull(); expect(root.textContent).toContain('<script>steal()</script>');
  });
  it('clears previous risks and describes an empty risk list honestly', () => {
    const root = document.createElement('section'); root.textContent = 'old risk';
    renderRisks(root,{summary:'test',topRisks:[]}); expect(root.textContent).not.toContain('old risk'); expect(root.textContent).toContain('does not confirm');
  });
  it('keeps only campaign identifiers and the referral hostname', () => {
    expect(attributionFrom('https://conduitco.io/?utm_source=google&utm_medium=cpc&utm_campaign=electrical_1&email=person@example.com','https://example.com/private/tender.pdf?token=secret')).toEqual({source:'google',medium:'cpc',campaign:'electrical_1',referralHost:'example.com'});
  });
  it('drops email-like UTM values and same-site referrals', () => {
    expect(attributionFrom('https://conduitco.io/?utm_source=person@example.com','https://conduitco.io/path')).toEqual({});
  });
});
