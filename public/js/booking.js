(() => {
  const ICONS = {
    'Cake Stand': '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="32" cy="18" rx="12" ry="3"/><path d="M20 18v6c0 1.7 5.4 3 12 3s12-1.3 12-3v-6"/><path d="M32 27v4"/><ellipse cx="32" cy="34" rx="20" ry="4"/><path d="M32 38v14"/><path d="M22 56h20l-4-4H26z"/></svg>',
    'Food Tray': '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="8" y="28" width="48" height="10" rx="3"/><path d="M4 33h4M56 33h4"/><circle cx="20" cy="24" r="4"/><circle cx="32" cy="23" r="5"/><circle cx="44" cy="24" r="4"/><path d="M14 38l-2 8M50 38l2 8"/></svg>',
    'Drink Dispenser': '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 10h20v4H22z"/><path d="M20 14h24v30a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4z"/><path d="M20 26h24"/><path d="M44 38h6v4h-2"/><path d="M18 52h28M22 52v6M42 52v6"/></svg>',
  };
  const DEFAULT_ICON = ICONS['Cake Stand'];

  const state = {
    products: [],
    selected: new Map(),   // productId -> quantity
    availability: new Map(), // productId -> { stock, reserved }
    currency: 'GBP',
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency }).format(n);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const pretty = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  $('year').textContent = new Date().getFullYear();

  // ---------- Calendar ----------
  function isBooked(date) {
    const day = iso(date);
    for (const [id, qty] of state.selected) {
      const a = state.availability.get(id);
      if (!a) continue;
      if ((a.reserved[day] || 0) + qty > a.stock) return true;
    }
    return false;
  }

  const fp = flatpickr($('dates'), {
    mode: 'range',
    inline: true,
    minDate: 'today',
    maxDate: new Date().fp_incr(365),
    disable: [isBooked],
    locale: { firstDayOfWeek: 1 },
    onDayCreate(_, __, ___, dayElem) {
      if (dayElem.classList.contains('flatpickr-disabled') && dayElem.dateObj >= new Date().setHours(0, 0, 0, 0) && isBooked(dayElem.dateObj)) {
        dayElem.classList.add('booked');
        dayElem.title = 'Already booked';
      }
    },
    onChange: updateDateLabels,
  });

  function selectedDates() {
    const [start, end] = fp.selectedDates;
    if (!start) return {};
    return { pickup: start, ret: end || null };
  }

  function updateDateLabels() {
    const { pickup, ret } = selectedDates();
    $('pickup-label').textContent = pickup ? pretty(pickup) : '—';
    $('return-label').textContent = ret ? pretty(ret) : (pickup ? 'Choose a date' : '—');
  }

  function rangeStillFree() {
    const { pickup, ret } = selectedDates();
    if (!pickup) return true;
    const end = ret || pickup;
    for (let d = new Date(pickup); d <= end; d.setDate(d.getDate() + 1)) {
      if (isBooked(d)) return false;
    }
    return true;
  }

  async function loadAvailability(ids) {
    const from = iso(new Date());
    const to = iso(new Date(Date.now() + 366 * 864e5));
    await Promise.all(ids.map(async (id) => {
      const res = await fetch(`/api/products/${id}/availability?from=${from}&to=${to}`);
      if (res.ok) state.availability.set(id, await res.json());
    }));
  }

  async function refreshCalendar(forceReload = false) {
    const ids = [...state.selected.keys()].filter((id) => forceReload || !state.availability.has(id));
    if (ids.length) await loadAvailability(ids);
    fp.set('disable', [isBooked]);
    if (!rangeStillFree()) {
      fp.clear();
      showError('Some of the dates you picked are not available for the items you selected – please choose again.');
    }
    fp.redraw();
    updateDateLabels();
    $('calendar-hint').textContent = state.selected.size
      ? 'Choose your pick-up date, then your drop-off date. Striped dates are already booked.'
      : 'Select the items you\'d like first, then choose your pick-up date followed by your drop-off date.';
  }

  // ---------- Products ----------
  function renderProducts() {
    const wrap = $('products');
    if (!state.products.length) {
      wrap.innerHTML = '<p class="muted center">Our collection is being updated – please check back soon.</p>';
      return;
    }
    wrap.innerHTML = state.products.map((p) => {
      const qty = state.selected.get(p.id);
      const media = p.image_url
        ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">`
        : (ICONS[p.category] || DEFAULT_ICON);
      return `
        <article class="product ${qty ? 'selected' : ''}" data-id="${p.id}">
          <div class="media">${media}</div>
          <div class="body">
            <div class="cat">${esc(p.category)}</div>
            <h3>${esc(p.name)}</h3>
            <p class="desc">${esc(p.description)}</p>
            <div class="foot">
              <div class="price">${money(p.price)} <small>/ rental</small></div>
              ${qty ? `
                <div class="qty">
                  ${p.stock > 1 ? `<input type="number" min="1" max="${p.stock}" value="${qty}" aria-label="Quantity" data-qty="${p.id}">` : ''}
                  <button class="btn btn-sm btn-outline" data-toggle="${p.id}" type="button">Remove</button>
                </div>`
              : `<button class="btn btn-sm" data-toggle="${p.id}" type="button">Add</button>`}
            </div>
          </div>
        </article>`;
    }).join('');
  }

  function renderSummary() {
    const list = $('selected-list');
    let total = 0;
    list.innerHTML = [...state.selected].map(([id, qty]) => {
      const p = state.products.find((x) => x.id === id);
      total += p.price * qty;
      return `<li><span>${qty > 1 ? `${qty} × ` : ''}${esc(p.name)}</span><span>${money(p.price * qty)}</span></li>`;
    }).join('');
    $('no-items').hidden = state.selected.size > 0;
    $('total').textContent = money(total);
  }

  $('products').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (!btn) return;
    const id = Number(btn.dataset.toggle);
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.set(id, 1);
    hideError();
    renderProducts();
    renderSummary();
    await refreshCalendar();
  });

  $('products').addEventListener('change', async (e) => {
    const input = e.target.closest('[data-qty]');
    if (!input) return;
    const id = Number(input.dataset.qty);
    const p = state.products.find((x) => x.id === id);
    const qty = Math.max(1, Math.min(p.stock, parseInt(input.value, 10) || 1));
    input.value = qty;
    state.selected.set(id, qty);
    renderSummary();
    await refreshCalendar();
  });

  // ---------- Form ----------
  function showError(msg) {
    const el = $('form-error');
    el.textContent = msg;
    el.hidden = false;
  }
  function hideError() { $('form-error').hidden = true; }

  $('booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const { pickup, ret } = selectedDates();
    const form = e.currentTarget;
    if (!state.selected.size) return showError('Please add at least one item from the collection.');
    if (!pickup || !ret) return showError('Please choose both a pick-up date and a drop-off date on the calendar.');
    for (const field of ['name', 'phone', 'email']) {
      if (!form[field].value.trim()) { form[field].focus(); return showError('Please fill in your name, phone and email.'); }
    }
    if (!form.email.checkValidity()) { form.email.focus(); return showError('Please enter a valid email address.'); }

    const btn = $('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.value, phone: form.phone.value, email: form.email.value,
          eventType: form.eventType.value, notes: form.notes.value,
          pickupDate: iso(pickup), returnDate: iso(ret),
          items: [...state.selected].map(([productId, quantity]) => ({ productId, quantity })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          // Someone else booked in the meantime – refresh the calendar so it shows the latest.
          const names = (data.conflicts || []).map((c) => c.name).join(', ');
          showError(`${data.error}${names ? ` (${names})` : ''} Please choose different dates.`);
          await refreshCalendar(true);
          fp.clear();
          updateDateLabels();
        } else {
          showError(data.error || 'Something went wrong. Please try again.');
        }
        return;
      }
      $('conf-ref').textContent = data.reference;
      $('conf-dates').textContent = `Pick-up ${pretty(pickup)} · Drop-off ${pretty(ret)} · Estimated total ${money(data.total)}`;
      $('booking-form-wrap').hidden = true;
      $('confirmation').hidden = false;
      $('book').scrollIntoView({ behavior: 'smooth' });
    } catch {
      showError('We could not reach the server. Please check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Request booking';
    }
  });

  $('book-another').addEventListener('click', async () => {
    state.selected.clear();
    state.availability.clear();
    $('booking-form').reset();
    fp.clear();
    renderProducts();
    renderSummary();
    await refreshCalendar();
    $('confirmation').hidden = true;
    $('booking-form-wrap').hidden = false;
    $('collection').scrollIntoView({ behavior: 'smooth' });
  });

  // ---------- Init ----------
  (async () => {
    try {
      const [config, products] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/products').then((r) => r.json()),
      ]);
      state.currency = config.currency || 'GBP';
      state.products = products;
    } catch {
      $('products').innerHTML = '<p class="muted center">We could not load the collection. Please refresh the page.</p>';
      return;
    }
    renderProducts();
    renderSummary();
  })();
})();
