import type { Audit } from '../shared/contracts';
export function renderRisks(container: HTMLElement, audit: Audit): void {
  container.replaceChildren();
  const heading = document.createElement('h4');
  heading.className = 'text-sm font-bold text-brand-amber';
  heading.textContent = 'Potential Tender Risks & Traps';
  container.appendChild(heading);
  if (audit.topRisks.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No specific risks were identified in this preliminary audit. This does not confirm that the tender is free of risk.';
    empty.className = 'text-sm text-slate-200'; container.appendChild(empty);
  }
  for (const risk of audit.topRisks) {
    const card = document.createElement('div');
    card.className = 'text-sm bg-brand-card p-4 rounded-lg border-l-4 border-brand-amber text-slate-200';
    const title = document.createElement('strong');
    title.className = 'text-brand-amber block mb-1 text-xs uppercase tracking-wide';
    title.textContent = risk.title;
    const description = document.createElement('p'); description.textContent = risk.description;
    card.append(title, description); container.appendChild(card);
  }
}
