import { Lexend_Exa, Lexend_Deca } from 'next/font/google';
import './globals.css';
// import 'highlight.js/styles/github.css';
import 'highlight.js/styles/github-dark.css';

const lexend_exa = Lexend_Exa({
  variable: '--font-lexend-exa',
  subsets: ['latin'],
});

const lexend_deca = Lexend_Deca({
  variable: '--font-lexend-deca',
  subsets: ['latin'],
});

export const metadata = {
  title: 'Agent + MCP Workflow',
  description: 'Run an OpenAI agent and save output to Strapi or WordPress',
};

export default function RootLayout({ children }) {
  return (
    <html
      lang='en'
      className={`no-scrollbar h-full scroll-pt-24 scroll-smooth antialiased lg:scroll-pt-36 ${lexend_exa.variable} ${lexend_deca.variable}`}
    >
      <body className='h-full bg-neutral-50 dark:bg-neutral-950'>
        {children}
      </body>
    </html>
  );
}
