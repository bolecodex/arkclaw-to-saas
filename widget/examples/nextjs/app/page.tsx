import { ClawProvider } from '../components/ClawProvider';

export default function Home() {
  return (
    <ClawProvider>
      <main style={{
        maxWidth: 720, margin: '60px auto', padding: 32,
        background: 'white', borderRadius: 16,
      }}>
        <h1>Next.js + ArkClaw</h1>
        <p>这是 Next.js App Router 集成示例。Widget 在客户端组件中初始化，避免 SSR 问题。</p>
        <p>试着划词或点击下面的输入框，会自动作为上下文推送给 AI。</p>
        <input name="email" placeholder="请输入邮箱"
          style={{ padding: 10, borderRadius: 8, border: '1px solid #ddd', width: '100%', fontSize: 14 }} />
      </main>
    </ClawProvider>
  );
}
