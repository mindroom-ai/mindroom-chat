import { describe, expect, it } from 'vitest';
import { sanitizeCustomHtml, customHtmlSanitizerPolicy } from './sanitize';

describe('customHtmlSanitizerPolicy', () => {
  it('drops a disallowed iframe with its fallback markup', () => {
    expect(
      sanitizeCustomHtml('a<iframe src="https://example.test"><b>fallback</b></iframe>b')
    ).toBe('ab');
  });

  it('keeps paste markers and Matrix math attributes needed by MindRoom rendering', () => {
    expect(customHtmlSanitizerPolicy.allowedAttributes?.span).toEqual(
      expect.arrayContaining([
        'data-mx-maths',
        'data-mindroom-paste-marker',
        'data-mindroom-paste-id',
        'data-mindroom-paste-chars',
        'data-mindroom-paste-file',
      ])
    );
    expect(customHtmlSanitizerPolicy.allowedAttributes?.div).toContain('data-mx-maths');

    const sanitized = sanitizeCustomHtml(
      [
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c"',
        ' data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        '[[mindroom-paste id=paste-a3f19c chars=11 file="mindroom-paste-a3f19c.txt"]]',
        '</span>',
        '<span data-mx-maths="x^2">x^2</span>',
        '<div data-mx-maths="\\frac{a}{b}">\\frac{a}{b}</div>',
      ].join('')
    );

    expect(sanitized).toContain('data-mindroom-paste-marker="true"');
    expect(sanitized).toContain('data-mindroom-paste-id="paste-a3f19c"');
    expect(sanitized).toContain('data-mx-maths="x^2"');
    expect(sanitized).toContain('data-mx-maths="\\frac{a}{b}"');
  });

  it('keeps the sanitizer strict around MindRoom policy additions', () => {
    const unsafeUrlScheme = ['java', 'script:'].join('');
    const sanitized = sanitizeCustomHtml(`
      <span data-mindroom-paste-marker="true" data-unsafe="x" onclick="alert(1)" style="position:absolute;color:#123">
        marker
      </span>
      <think onclick="alert(1)"><script>alert(1)</script>safe thought</think>
      <span data-mx-maths="x" style="background-image:url(${unsafeUrlScheme}alert(1));color:red">x</span>
    `);

    expect(sanitized).toContain('data-mindroom-paste-marker="true"');
    expect(sanitized).toContain('<think>safe thought</think>');
    expect(sanitized).toContain('data-mx-maths="x"');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('data-unsafe');
    expect(sanitized).not.toContain('position:absolute');
    expect(sanitized).not.toContain('background-image');
    expect(sanitized).not.toContain(unsafeUrlScheme);
    expect(sanitized).not.toContain('<script>');
  });

  it('adds custom style rules without replacing base style rules', () => {
    const sanitized = sanitizeCustomHtml(
      [
        '<p style="color:#123">hex</p>',
        '<p style="color:red">named</p>',
        '<p style="color:blue">blocked</p>',
      ].join(''),
      {
        policy: {
          allowedAttributes: {
            p: ['style'],
          },
          allowedStyles: {
            '*': {
              color: [/^red$/],
            },
          },
        },
      }
    );

    expect(sanitized).toContain('<p style="color:#123">hex</p>');
    expect(sanitized).toContain('<p style="color:red">named</p>');
    expect(sanitized).toContain('<p>blocked</p>');
  });

  it('does not let custom policy replace base security transformers', () => {
    const sanitized = sanitizeCustomHtml('<a href="https://example.com" target="_self">link</a>', {
      policy: {
        transformTags: {
          a: (tagName, attribs) => ({
            tagName,
            attribs: {
              ...attribs,
              rel: 'unsafe',
              target: '_self',
            },
          }),
        },
      },
    });

    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain('rel="noreferrer noopener"');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).not.toContain('rel="unsafe"');
    expect(sanitized).not.toContain('target="_self"');
  });

  it('allows configured application URI schemes without allowing dangerous browser schemes', () => {
    const scriptHref = `${'java'}script:alert(1)`;
    const sanitized = sanitizeCustomHtml(
      [
        '<a href="obsidian://open?vault=notes&amp;file=daily">note</a>',
        `<a href="${scriptHref}">script</a>`,
        '<a href="data:text/html,evil">data</a>',
        '<a href="file:///etc/passwd">file</a>',
      ].join(''),
      {
        additionalAllowedUriSchemes: ['Obsidian://', 'javascript', 'data', 'file', 'not a scheme'],
      }
    );

    expect(sanitized).toContain('href="obsidian://open?vault=notes&amp;file=daily"');
    expect(sanitized).not.toContain(scriptHref);
    expect(sanitized).not.toContain('data:text/html');
    expect(sanitized).not.toContain('file:///etc/passwd');
  });

  it('ignores malformed custom URI scheme configuration without breaking message rendering', () => {
    const link = '<a href="obsidian://open?vault=notes&amp;file=daily">note</a>';

    expect(() =>
      sanitizeCustomHtml(link, {
        additionalAllowedUriSchemes: 'obsidian',
      })
    ).not.toThrow();
    expect(
      sanitizeCustomHtml(link, {
        additionalAllowedUriSchemes: 'obsidian',
      })
    ).not.toContain('href=');

    const sanitized = sanitizeCustomHtml(link, {
      additionalAllowedUriSchemes: ['obsidian', null, 42, {}],
    });
    expect(sanitized).toContain('href="obsidian://open?vault=notes&amp;file=daily"');
  });

  describe('imageSource', () => {
    const SHOT = '<img src="https://github.com/user-attachments/assets/1234" alt="shot">';
    const MXC = '<img src="mxc://example.org/cat" alt="cat">';

    it('drops an https image and keeps an mxc one without a resolver, as before', () => {
      expect(sanitizeCustomHtml(SHOT)).not.toContain('<img');
      expect(sanitizeCustomHtml(SHOT, { additionalAllowedUriSchemes: ['https'] })).not.toContain(
        '<img'
      );
      expect(sanitizeCustomHtml(MXC)).toContain('src="mxc://example.org/cat"');
    });

    it('keeps an https image whose source the resolver returns', () => {
      const sanitized = sanitizeCustomHtml(SHOT, { imageSource: (src) => src });
      expect(sanitized).toContain('src="https://github.com/user-attachments/assets/1234"');
      expect(sanitized).toContain('alt="shot"');
    });

    it("uses the resolver's URL, and passes it the image's source", () => {
      const seen: string[] = [];
      const sanitized = sanitizeCustomHtml(SHOT, {
        imageSource: (src) => {
          seen.push(src);
          return 'https://proxy.example/image?id=1234';
        },
      });
      expect(seen).toEqual(['https://github.com/user-attachments/assets/1234']);
      expect(sanitized).toContain('src="https://proxy.example/image?id=1234"');
      expect(sanitized).not.toContain('github.com');
    });

    it('drops the image when the resolver returns nothing, a non-https or a credentialed URL', () => {
      const results = [
        undefined,
        '',
        'http://x.example/a.png',
        ['java', 'script:alert(1)'].join(''),
        'data:image/png;base64,AAAA',
        '//x.example/a.png',
        '/a.png',
        'not a url',
        'https://user:pass@x.example/a.png',
        'https://user@x.example/a.png',
      ];
      results.forEach((result) => {
        expect(sanitizeCustomHtml(SHOT, { imageSource: () => result })).not.toContain('<img');
      });
    });

    it('keeps mxc images as before, without asking the resolver', () => {
      const seen: string[] = [];
      const sanitized = sanitizeCustomHtml(MXC, {
        imageSource: (src) => {
          seen.push(src);
          return undefined;
        },
      });
      expect(sanitized).toContain('src="mxc://example.org/cat"');
      expect(seen).toEqual([]);
    });

    it("runs a caller's img transform first, so it cannot bypass the resolver", () => {
      const sanitized = sanitizeCustomHtml(MXC, {
        imageSource: () => undefined,
        policy: {
          transformTags: {
            img: (tagName, attribs) => ({
              tagName,
              attribs: { ...attribs, src: 'https://evil.example/a.png' },
            }),
          },
        },
      });
      expect(sanitized).not.toContain('<img');
      // Without a resolver the base rule still drops what the transform put in.
      expect(
        sanitizeCustomHtml(MXC, {
          policy: {
            transformTags: {
              img: (tagName, attribs) => ({
                tagName,
                attribs: { ...attribs, src: 'https://evil.example/a.png' },
              }),
            },
          },
        })
      ).not.toContain('<img');
    });
  });

  it('never keeps data-open-external or a button from message HTML', () => {
    const html = `<button data-open-external="https://evil.example">Click</button><a href="https://good.example" data-open-external="https://evil.example">Link</a><span data-open-external="https://evil.example">Text</span>`;
    const sanitized = sanitizeCustomHtml(html);
    expect(sanitized).not.toContain('<button');
    expect(sanitized).not.toContain('data-open-external');
  });

  describe('Markdown footnotes', () => {
    const FOOTNOTE_HTML = [
      '<p>Note<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>',
      ' and again<sup class="footnote-ref"><a href="#fn1" id="fnref1:1">[1:1]</a></sup>.</p>',
      '<hr class="footnotes-sep">',
      '<section class="footnotes">',
      '<ol class="footnotes-list">',
      '<li id="fn1" class="footnote-item"><p>Detail. ',
      '<a href="#fnref1" class="footnote-backref">↩︎</a> ',
      '<a href="#fnref1:1" class="footnote-backref">↩︎</a></p></li>',
      '</ol>',
      '</section>',
    ].join('');

    it('preserves footnote structure, IDs, classes, and local fragment hrefs without target="_blank"', () => {
      const sanitized = sanitizeCustomHtml(FOOTNOTE_HTML);

      expect(sanitized).toContain(
        '<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>'
      );
      expect(sanitized).toContain(
        '<sup class="footnote-ref"><a href="#fn1" id="fnref1:1">[1:1]</a></sup>'
      );
      expect(sanitized).toContain('class="footnotes-sep"');
      expect(sanitized).toContain('<section class="footnotes">');
      expect(sanitized).toContain('<ol class="footnotes-list">');
      expect(sanitized).toContain('<li id="fn1" class="footnote-item">');
      expect(sanitized).toContain('<a href="#fnref1" class="footnote-backref">↩︎</a>');
      expect(sanitized).toContain('<a href="#fnref1:1" class="footnote-backref">↩︎</a>');
      expect(sanitized).not.toContain('target=');
      expect(sanitized).not.toContain('rel=');
    });

    it('strips arbitrary ids and classes while keeping exact footnote ids and classes', () => {
      const sanitized = sanitizeCustomHtml(
        [
          '<a href="#fn1" id="root" target="_self" rel="opener" class="evil">[1]</a>',
          '<li id="root" class="footnote-item evil">bad li</li>',
          '<li id="fn1-evil" class="evil">bad suffix</li>',
          '<sup class="footnote-ref injected">ref</sup>',
          '<div class="footnotes" id="fn1">wrong tag</div>',
          '<section class="other">plain section</section>',
        ].join('')
      );

      expect(sanitized).toContain('<a href="#fn1">[1]</a>');
      expect(sanitized).toContain('<li class="footnote-item">bad li</li>');
      expect(sanitized).toContain('<li>bad suffix</li>');
      expect(sanitized).toContain('<sup class="footnote-ref">ref</sup>');
      expect(sanitized).toContain('<div>wrong tag</div>');
      expect(sanitized).toContain('<section>plain section</section>');
      expect(sanitized).not.toContain('id="root"');
      expect(sanitized).not.toContain('fn1-evil');
      expect(sanitized).not.toContain('evil');
      expect(sanitized).not.toContain('injected');
      expect(sanitized).not.toContain('target="_self"');
      expect(sanitized).not.toContain('rel="opener"');
    });

    it('keeps target="_blank" and rel on external and non-footnote links', () => {
      const sanitized = sanitizeCustomHtml(
        [
          '<a href="https://example.com" id="root">External</a>',
          '<a href="#heading">Other fragment</a>',
          '<a href="#fn1" id="fnref1">[1]</a>',
        ].join('')
      );

      expect(sanitized).toContain(
        '<a href="https://example.com" target="_blank" rel="noreferrer noopener">External</a>'
      );
      expect(sanitized).toContain(
        '<a href="#heading" target="_blank" rel="noreferrer noopener">Other fragment</a>'
      );
      expect(sanitized).toContain('<a href="#fn1" id="fnref1">[1]</a>');
    });

    it('merges caller allowedClasses without dropping footnote or code classes', () => {
      const sanitized = sanitizeCustomHtml(
        '<a href="#fnref1" class="footnote-backref custom">↩︎</a><code class="language-ts">x</code>',
        { policy: { allowedClasses: { a: ['custom'] } } }
      );

      expect(sanitized).toContain('class="footnote-backref custom"');
      expect(sanitized).toContain('class="language-ts"');
    });
  });

  describe('caching', () => {
    it('reuses cached sanitized HTML across equivalent plain option objects without colliding with custom policy', () => {
      const html = '<a href="obsidian://open?vault=notes" class="custom">Open</a>';
      const first = sanitizeCustomHtml(html, { additionalAllowedUriSchemes: ['obsidian'] });
      const second = sanitizeCustomHtml(html, { additionalAllowedUriSchemes: ['obsidian'] });
      const withPolicy = sanitizeCustomHtml(html, {
        additionalAllowedUriSchemes: ['obsidian'],
        policy: { allowedClasses: { a: ['custom'] } },
      });

      expect(first).toBe(second);
      expect(first).toContain('href="obsidian://open?vault=notes"');
      expect(first).not.toContain('class="custom"');
      expect(withPolicy).toContain('class="custom"');
    });

    it('does not serve stale cached HTML when imageSource changes', () => {
      let current = 'https://cdn.example.org/a.png';
      const imageSource = () => current;
      const html = '<img src="relative/pic.png" alt="pic" />';

      const first = sanitizeCustomHtml(html, { imageSource });
      current = 'https://cdn.example.org/b.png';
      const second = sanitizeCustomHtml(html, { imageSource });

      expect(first).toContain('src="https://cdn.example.org/a.png"');
      expect(second).toContain('src="https://cdn.example.org/b.png"');
    });

    it('bypasses options and result caches when custom policy decisions or imageSource change on the same options object', () => {
      let allowClass = false;
      const policyOptions: Parameters<typeof sanitizeCustomHtml>[1] = {
        policy: {
          allowedClasses: { span: ['dynamic'] },
          transformTags: {
            span: (tagName, attribs) => ({
              tagName,
              attribs: allowClass ? attribs : {},
            }),
          },
        },
      };
      const spanHtml = '<span class="dynamic">hello</span>';

      expect(sanitizeCustomHtml(spanHtml, policyOptions)).toBe('<span>hello</span>');
      allowClass = true;
      expect(sanitizeCustomHtml(spanHtml, policyOptions)).toBe(
        '<span class="dynamic">hello</span>'
      );

      policyOptions.policy = { allowedClasses: { span: [] } };
      expect(sanitizeCustomHtml(spanHtml, policyOptions)).toBe('<span>hello</span>');

      const imgHtml = '<img src="relative/pic.png" alt="pic" />';
      const imageOptions: Parameters<typeof sanitizeCustomHtml>[1] = {
        imageSource: () => 'https://cdn.example.org/first.png',
      };
      expect(sanitizeCustomHtml(imgHtml, imageOptions)).toContain(
        'src="https://cdn.example.org/first.png"'
      );
      imageOptions.imageSource = () => 'https://cdn.example.org/second.png';
      expect(sanitizeCustomHtml(imgHtml, imageOptions)).toContain(
        'src="https://cdn.example.org/second.png"'
      );
    });

    it('keeps results accurate beyond the bounded LRU cache capacity', () => {
      for (let i = 0; i < 80; i += 1) {
        expect(sanitizeCustomHtml(`<p>entry-${i}</p>`)).toBe(`<p>entry-${i}</p>`);
      }
      expect(sanitizeCustomHtml('<p>entry-0</p>')).toBe('<p>entry-0</p>');
      expect(sanitizeCustomHtml('<p>entry-79</p>')).toBe('<p>entry-79</p>');
    });
  });
});
