// Runs inside the standalone DAG page.
(() => {
  const { nodes, edges = [], groups = [], lanes, columns } = JSON.parse(document.getElementById('node-data').textContent);
  const cards = document.querySelectorAll('.n[data-index]');
  const preview = document.getElementById('node-preview');
  const dialog = document.getElementById('node-dialog');
  const fields = dialog.querySelector('dl');
  const names = { id: 'Task ID', sub: '작업 내용', lane: '레인', col: '슬롯', row: '행', bl: '백로그', status: '상태', kind: '종류', write: '외부 쓰기', agent: '런타임', role: '역할', unit: '작업 단위', model: '모델', effort: 'effort', base: '기준값', recommended: '추천', why: '추천 근거', fixed: '고정 배정', complexity: '복잡도', dims: '차원별 점수', members: '팀 내부 배정', overrideReason: '사용자 예외' };
  let active;
  function showPreview(card) {
    if (dialog.open || ![...card.querySelectorAll('.node-copy > *')].some(el => el.scrollWidth > el.clientWidth)) return;
    active = card;
    const node = nodes[card.dataset.index];
    preview.querySelector('strong').textContent = node.title;
    preview.querySelector('span').textContent = node.sub;
    preview.hidden = false;
    const rect = card.querySelector('rect').getBoundingClientRect();
    preview.style.left = Math.max(4, Math.min(rect.left, innerWidth - preview.offsetWidth - 4)) + 'px';
    preview.style.top = Math.max(4, Math.min(rect.top, innerHeight - preview.offsetHeight - 4)) + 'px';
  }
  function add(label, value) {
    const term = document.createElement('dt'), desc = document.createElement('dd');
    term.textContent = label;
    desc.textContent = typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value ?? '없음');
    fields.append(term, desc);
  }
  function openDetails(card) {
    active = card;
    preview.hidden = true;
    const node = nodes[card.dataset.index];
    dialog.querySelector('h2').textContent = node.title;
    fields.replaceChildren();
    for (const [key, value] of Object.entries(node)) {
      if (key === 'title') continue;
      if (key === 'routing') {
        const template = document.getElementById('routing-' + card.dataset.index);
        if (template) fields.append(template.content.cloneNode(true));
        continue;
      }
      let display = value;
      if (key === 'lane') display = lanes.find(l => l.id === value)?.name + ' (' + value + ')';
      if (key === 'col') display = columns[value] + ' (' + value + ')';
      if (key === 'status') display = { done: '완료', run: '진행', wait: '대기' }[value] ?? value;
      add(Object.hasOwn(names, key) ? names[key] : key, display);
    }
    const pick = card.nextElementSibling?.querySelector('.pick[data-node]');
    if (pick) {
      const selected = pick.querySelector('select').value;
      if (pick.dataset.recommended) {
        add('배정 방식', selected ? '직접 지정 · 기동 시 고정' : '추천 사용 · 기동 직전 재평가 허용');
        add('현재 선택', pick.querySelector('.cx').textContent);
      } else {
        add('현재 선택', pick.querySelector('input').checked ? 'Codex · ' + selected + ' ' + pick.querySelector('.cx').textContent : 'Claude · ' + selected);
      }
    }
    const groupIds = groups.filter(g => g.nodes.includes(node.id)).map(g => g.id);
    if (groupIds.length) add('소속 그룹', groupIds.join(', '));
    const endpoints = new Set([node.id, ...groupIds]);
    for (const [label, key] of [['들어오는 연결', 'to'], ['나가는 연결', 'from']]) {
      const related = edges.filter(e => endpoints.has(e[key]));
      add(label, related.length ? related.map(e => e.from + ' → ' + e.to + [e.label, e.loop && '재검', e.merge && '합류'].filter(Boolean).map(x => ' · ' + x).join('')).join('\n') : '없음');
    }
    dialog.showModal();
  }
  for (const card of cards) {
    card.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showPreview(card); });
    card.addEventListener('pointerleave', e => { if (!preview.contains(e.relatedTarget)) preview.hidden = true; });
    card.addEventListener('click', () => openDetails(card));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(card); }
    });
  }
  preview.addEventListener('pointerleave', e => { if (!active?.contains(e.relatedTarget)) preview.hidden = true; });
  preview.addEventListener('click', () => openDetails(active));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') preview.hidden = true; });
  document.addEventListener('scroll', e => { if (e.target !== preview) preview.hidden = true; }, true);
  window.addEventListener('resize', () => { preview.hidden = true; });
  dialog.addEventListener('close', () => active?.focus({ preventScroll: true }));
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
})();
