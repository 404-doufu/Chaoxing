/* 特殊字体文字适配：只处理页面已经提供的内嵌 TrueType 字体，不发起网络请求。 */
function createFontDecoder({ win, doc }) {
    const signatures = /* FONT_SIGNATURES */{};
    let lastSource = null, mapping = new Map(), failure = '';
    function sha1(bytes) {
        const size = Math.ceil((bytes.length + 9) / 64) * 64, data = new Uint8Array(size);
        data.set(bytes); data[bytes.length] = 128;
        const view = new DataView(data.buffer);
        view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000));
        view.setUint32(size - 4, bytes.length * 8);
        let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476, e = 0xc3d2e1f0;
        const words = new Int32Array(80), rotate = (n, bits) => (n << bits) | (n >>> (32 - bits));
        for (let offset = 0; offset < size; offset += 64) {
            for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4);
            for (let i = 16; i < 80; i++) words[i] = rotate(words[i-3] ^ words[i-8] ^ words[i-14] ^ words[i-16], 1);
            let aa = a, bb = b, cc = c, dd = d, ee = e;
            for (let i = 0; i < 80; i++) {
                const f = i < 20 ? (bb & cc) | (~bb & dd) : i < 40 || i >= 60 ? bb ^ cc ^ dd : (bb & cc) | (bb & dd) | (cc & dd);
                const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
                const temp = (rotate(aa, 5) + f + ee + k + words[i]) | 0;
                ee = dd; dd = cc; cc = rotate(bb, 30); bb = aa; aa = temp;
            }
            a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0; e = (e + ee) | 0;
        }
        return [a,b,c,d,e].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
    }
    function parse(bytes) {
        if (bytes.length < 12 || bytes.length > 2 * 1024 * 1024) throw new Error('字体大小异常');
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const within = (offset, size) => { if (!Number.isInteger(offset) || offset < 0 || size < 0 || offset + size > bytes.length) throw new Error('字体数据不完整'); return offset; };
        const u16 = o => v.getUint16(within(o,2)), i16 = o => v.getInt16(within(o,2)), u32 = o => v.getUint32(within(o,4));
        if (u32(0) !== 0x10000) throw new Error('暂不支持此字体格式');
        const tables = new Map(), count = u16(4);
        if (count > 128) throw new Error('字体表数量异常');
        for (let i = 0; i < count; i++) {
            const o = 12 + i * 16, tag = String.fromCharCode(...bytes.slice(within(o,16),o+4));
            const start = u32(o+8), length = u32(o+12); within(start,length); tables.set(tag,{start,length});
        }
        const table = tag => { const t = tables.get(tag); if (!t) throw new Error('缺少字体表：' + tag); return t; };
        const head = table('head'), loca = table('loca'), glyf = table('glyf'), maxp = table('maxp'), cmap = table('cmap');
        const glyphCount = u16(maxp.start+4), longOffsets = i16(head.start+50) === 1;
        const offsets = [];
        if ((glyphCount+1)*(longOffsets?4:2) > loca.length) throw new Error('字形索引不完整');
        for (let i = 0; i <= glyphCount; i++) {
            const offset = longOffsets ? u32(loca.start+i*4) : u16(loca.start+i*2)*2;
            if (offset > glyf.length || (i && offset < offsets[i-1])) throw new Error('字形边界异常');
            offsets.push(offset);
        }
        const chars = new Map(), records = u16(cmap.start+2);
        let processed = 0;
        if (records > 128) throw new Error('字符表数量异常');
        for (let i = 0; i < records; i++) {
            const record = cmap.start+4+i*8, platform = u16(record), encoding = u16(record+2);
            if (platform !== 0 && !(platform === 3 && [1,10].includes(encoding))) continue;
            const s = cmap.start+u32(record+4), format = u16(s);
            if (format === 4) {
                const length = u16(s+2), n = u16(s+6)/2;
                if (s+length > cmap.start+cmap.length || !Number.isInteger(n) || n > 8192) throw new Error('字符映射异常');
                const ends = s+14, starts = ends+n*2+2, deltas = starts+n*2, ranges = deltas+n*2;
                for (let j = 0; j < n; j++) {
                    const start = u16(starts+j*2), end = u16(ends+j*2), delta = i16(deltas+j*2), range = u16(ranges+j*2);
                    for (let cp = start; cp <= end && cp < 0xffff; cp++) {
                        if (++processed > 262144) throw new Error('字符映射数量异常');
                        const pos = ranges+j*2+range+2*(cp-start);
                        if (range && pos+2 > s+length) throw new Error('字符索引越界');
                        const raw = range ? u16(pos) : cp;
                        const glyph = range && raw === 0 ? 0 : (raw+delta)&0xffff;
                        if (glyph && glyph < glyphCount) chars.set(cp,glyph);
                    }
                }
            } else if (format === 12) {
                const length = u32(s+4), n = u32(s+12);
                if (n > 65536 || s+length > cmap.start+cmap.length || 16+n*12 > length) throw new Error('字符映射异常');
                for (let j = 0; j < n; j++) {
                    const o = s+16+j*12, start = u32(o), end = u32(o+4), first = u32(o+8);
                    if (end < start || end-start > 65536 || end > 0x10ffff) throw new Error('字符范围异常');
                    for (let cp = start; cp <= end; cp++) {
                        if (++processed > 262144) throw new Error('字符映射数量异常');
                        if (first+cp-start < glyphCount) chars.set(cp,first+cp-start);
                    }
                }
            }
        }
        if (!chars.size) throw new Error('未找到可用字符映射');
        const result = new Map();
        for (const [cp,glyph] of chars) {
            const start = glyf.start+offsets[glyph], end = glyf.start+offsets[glyph+1];
            result.set(String.fromCodePoint(cp), signatures[sha1(bytes.subarray(start,end))] || null);
        }
        return result;
    }
    function prepare() {
        const styles = Array.from(doc.querySelectorAll('style')).map(x => x.textContent).filter(x => /@font-face/i.test(x) && /font-cxsecret/i.test(x));
        const sources = styles.flatMap(css => Array.from(css.matchAll(/url\(\s*['"]?data:[^,;)]+(?:;[^,)]*)?;base64,([A-Za-z0-9+/=\s]+)['"]?\s*\)/gi), m => m[1].replace(/\s/g,'')));
        const source = sources.join('|');
        if (source === lastSource) return;
        lastSource = source; mapping = new Map(); failure = '';
        try {
            if (sources.length !== 1) throw new Error(sources.length ? '检测到多份特殊字体' : '特殊字体尚未加载');
            if (source.length > 2800000) throw new Error('字体数据过大');
            const binary = win.atob(source), bytes = Uint8Array.from(binary, x => x.charCodeAt(0));
            mapping = parse(bytes);
        } catch (e) { failure = e.message; }
    }
    function decode(copy, inherited = false) {
        const walker = doc.createTreeWalker(copy, 4);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!inherited && !node.parentElement?.closest('.font-cxsecret')) continue;
            if (failure) throw new Error('特殊字体未能还原：' + failure + '；请稍后重试或人工处理');
            node.nodeValue = Array.from(node.nodeValue).map(char => {
                if (!mapping.has(char)) return char;
                const decoded = mapping.get(char);
                if (!decoded) throw new Error('特殊字体含未识别字形；为避免乱码答题已跳过');
                return decoded;
            }).join('');
        }
    }
    return { prepare, decode, parse, sha1 };
}
