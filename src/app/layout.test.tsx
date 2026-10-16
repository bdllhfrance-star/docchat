// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import RootLayout from "./layout";

test("serves light mode before hydration, without restoring device or saved theme", () => {
  const html = renderToStaticMarkup(
    <RootLayout params={Promise.resolve({})}><div>Contenu</div></RootLayout>,
  );
  expect(html).toContain('style="color-scheme:light"');
  expect(html).not.toContain('class="dark');
  expect(html).not.toContain("prefers-color-scheme");
  expect(html).not.toContain("localStorage");
});
