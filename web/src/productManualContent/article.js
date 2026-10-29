/** 统一产品手册文章结构，让每篇都有业务流、实现链和能力边界。 */
export function manualArticle(title, intro, flow, implementation, boundaries) {
  return `# ${title}

${intro}

## 业务流程

\`\`\`text
${flow}
\`\`\`

## 实现逻辑

${implementation}

## 边界说明

${boundaries}
`
}
