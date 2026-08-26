import "./globals.css";

export const metadata = {
  title: "百度一下 - 教师节 Doodle 预览",
  description: "教师节互动 Doodle",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
