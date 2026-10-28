import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toPlainAnswer } from "./answer";

describe("toPlainAnswer", () => {
  it("başlıklar kalın satıra döner", () => {
    assert.equal(toPlainAnswer("# Başlık\nmetin\n### Alt başlık\nmetin"), "**Başlık**\nmetin\n**Alt başlık**\nmetin");
    // Zaten kalın olan başlık iki kez sarılmaz.
    assert.equal(toPlainAnswer("## **Uyarı**"), "**Uyarı**");
    // Boşluksuz # başlık değildir.
    assert.equal(toPlainAnswer("#etiket"), "#etiket");
  });

  it("bağlantılar 'metin (url)' olur", () => {
    assert.equal(toPlainAnswer("Bkz. [MGM](https://mgm.gov.tr/x) sayfası."), "Bkz. MGM (https://mgm.gov.tr/x) sayfası.");
    assert.equal(toPlainAnswer("[a](https://a.example/p?q=1 \"başlık\")"), "a (https://a.example/p?q=1)");
    assert.equal(toPlainAnswer("![grafik](https://a.example/g.png)"), "grafik (https://a.example/g.png)");
  });

  it("HTML etiketleri atılır, '<5 km' gibi ifadeler korunur", () => {
    assert.equal(toPlainAnswer("a <b>kalın</b> <br/> <a href=\"x\">bağ</a>"), "a kalın  bağ");
    assert.equal(toPlainAnswer("Mesafe <5 km ve 3 < 4"), "Mesafe <5 km ve 3 < 4");
  });

  it("kalın korunur; __kalın__ ** olur; snake_case bozulmaz", () => {
    assert.equal(toPlainAnswer("**önemli** ve __çok önemli__"), "**önemli** ve **çok önemli**");
    assert.equal(toPlainAnswer("dosya__adı__x"), "dosya__adı__x");
  });

  it("* ve + madde işaretleri '- ' olur, - korunur", () => {
    assert.equal(toPlainAnswer("* bir\n+ iki\n- üç\n  * iç"), "- bir\n- iki\n- üç\n  - iç");
    assert.equal(toPlainAnswer("**kalın** satır"), "**kalın** satır");
  });

  it("kod çitleri kalkar, içerik kalır", () => {
    assert.equal(toPlainAnswer("Önce:\n```js\nlet a = 1;\n```\nSonra"), "Önce:\nlet a = 1;\nSonra");
  });

  it("üç ya da daha fazla boş satır ikiye iner; CRLF LF olur", () => {
    assert.equal(toPlainAnswer("a\n\n\n\nb"), "a\n\nb");
    assert.equal(toPlainAnswer("a\r\n \r\n\t\r\n\r\nb"), "a\n\nb");
    assert.equal(toPlainAnswer("a\n\nb"), "a\n\nb");
  });

  it("düz metin değişmeden kalır", () => {
    const t = "Yarın Bursa'da hava 24 derece.\n\n- Şemsiye almayın\n- İnce giyinin";
    assert.equal(toPlainAnswer(t), t);
  });
});
