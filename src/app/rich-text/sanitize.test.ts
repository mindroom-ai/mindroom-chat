import { describe, expect, it } from 'vitest';
import { sanitizeCustomHtml, customHtmlSanitizerPolicy } from './sanitize';

describe('customHtmlSanitizerPolicy', () => {
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
});
