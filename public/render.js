// render.js — DOM rendering module

// --- Markdown ---

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMarkdown(md) {
  if (!md) return '';

  // Code blocks
  let html = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`;
  });

  // Unordered lists (must come before general line processing)
  html = html.replace(/^([ \t]*[-*] .+(?:\n[ \t]*[-*] .+)*)/gm, (block) => {
    const items = block.split('\n').map(line =>
      `<li>${line.replace(/^[ \t]*[-*] /, '')}</li>`
    ).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/^([ \t]*\d+\. .+(?:\n[ \t]*\d+\. .+)*)/gm, (block) => {
    const items = block.split('\n').map(line =>
      `<li>${line.replace(/^[ \t]*\d+\. /, '')}</li>`
    ).join('');
    return `<ol>${items}</ol>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    return `<code class="inline-code">${escapeHtml(code)}</code>`;
  });

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs around block elements
  html = html.replace(/<p>(<(?:pre|ul|ol)>)/g, '$1');
  html = html.replace(/(<\/(?:pre|ul|ol)>)<\/p>/g, '$1');

  return html;
}

// --- Auto-resize ---

export function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 400) + 'px';
}

// --- Agent Bar ---

export function renderAgentBar(agents, currentId, { onSelect, onCreate, onDelete, onDuplicate, onRename }) {
  const bar = document.getElementById('agent-bar');
  bar.innerHTML = '';

  for (const agent of agents) {
    const tab = document.createElement('button');
    tab.className = 'agent-tab' + (agent.id === currentId ? ' active' : '');
    tab.textContent = agent.name;
    tab.title = agent.name;

    tab.addEventListener('click', () => onSelect(agent.id));

    tab.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'agent-tab-rename';
      input.value = agent.name;
      tab.textContent = '';
      tab.appendChild(input);
      input.focus();
      input.select();

      const finish = () => {
        const newName = input.value.trim() || agent.name;
        onRename(agent.id, newName);
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') input.blur();
        if (ke.key === 'Escape') { input.value = agent.name; input.blur(); }
      });
    });

    // Context menu
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Rename', action: () => tab.dispatchEvent(new Event('dblclick')) },
        { label: 'Duplicate', action: () => onDuplicate(agent.id) },
        { label: 'Delete', action: () => onDelete(agent.id), danger: true },
      ]);
    });

    bar.appendChild(tab);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'agent-tab agent-tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'New agent';
  addBtn.addEventListener('click', onCreate);
  bar.appendChild(addBtn);
}

function showContextMenu(x, y, items) {
  // Remove any existing context menu
  const existing = document.getElementById('ctx-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.className = 'context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  for (const item of items) {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    if (item.danger) btn.classList.add('danger');
    btn.addEventListener('click', () => {
      menu.remove();
      item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  const dismiss = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

// --- Messages ---

export function renderMessages(messages, { onInsert, onDelete, onEditContent, onToggleRole, onAddImage, onAddImageUrl, onRemoveImage }) {
  const area = document.getElementById('messages');
  area.innerHTML = '';

  const callbacks = { onInsert, onDelete, onEditContent, onToggleRole, onAddImage, onAddImageUrl, onRemoveImage };

  // Insert point at top
  area.appendChild(makeInsertPoint(0, onInsert));

  for (let i = 0; i < messages.length; i++) {
    area.appendChild(renderMessageBlock(messages[i], i, callbacks));
    area.appendChild(makeInsertPoint(i + 1, onInsert));
  }
}

function makeInsertPoint(index, onInsert) {
  const wrap = document.createElement('div');
  wrap.className = 'insert-point';

  const btn = document.createElement('button');
  btn.className = 'insert-btn';
  btn.innerHTML = '<span class="insert-line"></span><span class="insert-icon">+</span><span class="insert-line"></span>';
  btn.addEventListener('click', () => onInsert(index));
  wrap.appendChild(btn);
  return wrap;
}

export function renderMessageBlock(msg, index, { onDelete, onEditContent, onToggleRole, onAddImage, onAddImageUrl, onRemoveImage }) {
  const block = document.createElement('div');
  block.className = `message-block ${msg.role}`;
  block.dataset.index = index;

  // Header row: role badge + delete
  const header = document.createElement('div');
  header.className = 'message-header';

  const roleBadge = document.createElement('button');
  roleBadge.className = `role-badge ${msg.role}`;
  roleBadge.textContent = msg.role;
  roleBadge.title = 'Click to toggle role';
  roleBadge.addEventListener('click', () => onToggleRole(index));

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const imageBtn = document.createElement('button');
  imageBtn.className = 'msg-action-btn';
  imageBtn.textContent = '+ Image';
  imageBtn.title = 'Add image';
  imageBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => {
      for (const file of input.files) {
        onAddImage(index, file);
      }
    });
    input.click();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'msg-action-btn delete-btn';
  deleteBtn.innerHTML = '&times;';
  deleteBtn.title = 'Delete message';
  deleteBtn.addEventListener('click', () => onDelete(index));

  actions.appendChild(imageBtn);
  actions.appendChild(deleteBtn);
  header.appendChild(roleBadge);
  header.appendChild(actions);
  block.appendChild(header);

  // Content area
  if (msg.role === 'user') {
    const textarea = document.createElement('textarea');
    textarea.className = 'message-content-edit';
    textarea.value = msg.content || '';
    textarea.rows = 1;
    textarea.addEventListener('input', () => {
      autoResize(textarea);
      onEditContent(index, textarea.value);
    });
    block.appendChild(textarea);
    // Auto-resize after mount
    requestAnimationFrame(() => autoResize(textarea));
  } else {
    // Assistant: rendered markdown by default, click to edit
    const display = document.createElement('div');
    display.className = 'message-content-display';
    display.innerHTML = renderMarkdown(msg.content || '');

    display.addEventListener('click', () => {
      const textarea = document.createElement('textarea');
      textarea.className = 'message-content-edit';
      textarea.value = msg.content || '';
      textarea.rows = 1;
      block.replaceChild(textarea, display);
      requestAnimationFrame(() => {
        autoResize(textarea);
        textarea.focus();
      });

      textarea.addEventListener('input', () => {
        autoResize(textarea);
        onEditContent(index, textarea.value);
      });

      textarea.addEventListener('blur', () => {
        display.innerHTML = renderMarkdown(textarea.value);
        block.replaceChild(display, textarea);
      });
    });

    block.appendChild(display);
  }

  // Images
  if (msg.images && msg.images.length > 0) {
    const imgRow = document.createElement('div');
    imgRow.className = 'image-row';
    for (let i = 0; i < msg.images.length; i++) {
      const thumb = document.createElement('div');
      thumb.className = 'image-thumb';

      const img = document.createElement('img');
      img.src = msg.images[i];

      const removeBtn = document.createElement('button');
      removeBtn.className = 'image-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', () => onRemoveImage(index, i));

      thumb.appendChild(img);
      thumb.appendChild(removeBtn);
      imgRow.appendChild(thumb);
    }
    block.appendChild(imgRow);
  }

  // Drag-drop and paste support for images
  block.addEventListener('dragover', (e) => {
    e.preventDefault();
    block.classList.add('drag-over');
  });
  block.addEventListener('dragleave', () => block.classList.remove('drag-over'));
  block.addEventListener('drop', (e) => {
    e.preventDefault();
    block.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith('image/')) onAddImage(index, file);
    }
  });
  block.addEventListener('paste', (e) => {
    // Check for pasted image files
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        onAddImage(index, item.getAsFile());
        return;
      }
    }
    // Check for pasted image URL
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (text && /^https?:\/\/.+\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(text)) {
      e.preventDefault();
      onAddImageUrl(index, text);
    }
  });

  return block;
}
