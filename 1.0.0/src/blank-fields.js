/* 文字填空控件：每个空独立绑定；富文本仅使用已存在的编辑器，不新建或改写平台提交接口。 */
function createBlankFields({ win, doc, page }) {
    const clean = value => String(value || '').replace(/[\u200b\ufeff]/g,'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
    function text(html) { const node = doc.createElement('div'); node.innerHTML = html || ''; return clean(node.textContent); }
    function editor(field) {
        return Object.values(win.UE?.instants || {}).find(value => value &&
            (value.key === field.input.id || (field.frame && (value.iframe === field.frame || value.container?.contains(field.frame)))));
    }
    function find(root) {
        const groups = Array.from(root.querySelectorAll(page.blankGroupSelector));
        const units = groups.length ? groups.filter(group => !groups.some(other => other !== group && other.contains(group))) :
            Array.from(root.querySelectorAll(page.blankInputSelector)).filter(node => !node.closest('.dsa-result,.edui-editor') && !Array.from(root.querySelectorAll('[contenteditable="true"]')).some(other => other !== node && other.contains(node)));
        return units.map((unit,index) => {
            const rich = unit.matches?.('textarea[id^="answerEditor"],textarea[name^="answerEditor"]') ? unit : unit.querySelector?.('textarea[id^="answerEditor"],textarea[name^="answerEditor"]');
            const frame = unit.querySelector?.('.edui-editor iframe,iframe[id^="ueditor"]');
            const input = rich || (unit.matches?.(page.blankInputSelector) ? unit : unit.querySelector?.(page.blankInputSelector));
            if (!input) return {index,reason:'未识别到第 '+(index+1)+' 空的输入控件'};
            return {index,input,frame,kind:rich ? 'ueditor' : input.hasAttribute('contenteditable') ? 'editable' : 'input',mirror:unit.querySelector?.('.InpDIV')};
        });
    }
    function ready(field) {
        if (!field.input?.isConnected) return false;
        if (field.kind === 'ueditor') {
            const value = editor(field);
            return !!(value && value.isReady !== false && typeof value.setContent === 'function' && typeof value.getContent === 'function');
        }
        return page.visible(field.input);
    }
    function read(field) {
        if (!field.input) return '';
        if (field.kind === 'ueditor') {
            const value = editor(field);
            if (value?.getContentTxt) return clean(value.getContentTxt());
            if (value?.getContent) return text(value.getContent());
            return text(field.input.value);
        }
        return clean(field.kind === 'editable' ? field.input.textContent : field.input.value);
    }
    function synced(field) {
        if (!ready(field) || !read(field)) return false;
        if (field.kind !== 'ueditor') return true;
        const value = read(field);
        return text(field.input.value) === value && (!field.mirror || text(field.mirror.innerHTML) === value);
    }
    function sync(field) {
        if (field.kind !== 'ueditor' || !ready(field)) return;
        const ed = editor(field); ed.sync?.(); field.input.value = ed.getContent();
    }
    function write(field,value) {
        if (!ready(field)) throw new Error('填空编辑器未就绪，请稍后重试');
        if (field.input.disabled || field.input.readOnly || field.input.getAttribute('aria-disabled') === 'true') throw new Error('填空控件不可编辑');
        if (field.kind === 'ueditor') {
            const ed = editor(field);
            if (ed.body?.getAttribute('contenteditable') === 'false') throw new Error('填空编辑器只读');
            const safe = value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])).replace(/\r?\n/g,'<br>');
            ed.setContent('<p>'+safe+'</p>');
            ed.fireEvent?.('contentChange');
            sync(field);
        } else if (field.kind === 'editable') {
            if (field.input.getAttribute('contenteditable') !== 'true') throw new Error('填空区域不可编辑');
            field.input.textContent = value;
        } else {
            const prototype = field.input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype,'value')?.set;
            if (setter) setter.call(field.input,value); else field.input.value = value;
        }
        field.input.dispatchEvent(new win.Event('input',{bubbles:true}));
        field.input.dispatchEvent(new win.Event('change',{bubbles:true}));
        if (read(field) !== clean(value) || !synced(field)) throw new Error('填空显示内容与提交字段未同步，请检查建议答案后手动填写');
    }
    return { find, ready, read, synced, sync, write };
}
