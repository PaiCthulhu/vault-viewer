import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _processor: any = null

function getProcessor() {
  if (!_processor) {
    _processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath, { singleDollarTextMath: false })
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeKatex, { throwOnError: false, strict: false })
      .use(rehypeSlug)
      .use(rehypeStringify)
  }
  return _processor
}

export async function renderMarkdown(markdown: string): Promise<string> {
  const result = await getProcessor().process(markdown)
  return String(result)
}
