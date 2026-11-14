'use client';

import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/** Some models write math as \(...\) and \[...\]; remark-math reads $...$ and $$...$$. */
const dollarMath = (t: string): string =>
  t.replace(/\\\[([\s\S]+?)\\\]/g, (_m, x: string) => `$$${x}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_m, x: string) => `$${x}$`);

/** Answers: Markdown without raw HTML (react-markdown escapes it), LaTeX math through KaTeX, code blocks. Loaded only on the AI pages. */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-ai flex flex-col gap-2 break-words text-base leading-relaxed [&_a]:text-indigo-700 [&_a]:underline [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-slate-100 [&_pre_code]:bg-transparent [&_ul]:list-disc [&_ul]:pl-6 [&_.katex-display]:overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ a: ({ href, children: c }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow">{c}</a> }}>
        {dollarMath(children)}
      </ReactMarkdown>
    </div>
  );
}
