export default function LoginPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center space-y-6 px-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-white tracking-tight">AI Company</h1>
          <p className="text-gray-400 text-lg">Nền tảng tư vấn doanh nghiệp AI cho thị trường Việt Nam</p>
        </div>
        <div className="space-y-3">
          <button
            onClick={() => { window.location.href = "/api/login"; }}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-8 py-3 rounded-lg transition-colors w-full justify-center"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm-1-11v6l5-3-5-3z"/>
            </svg>
            Đăng nhập với Replit
          </button>
        </div>
        <p className="text-gray-600 text-sm">
          Cần có tài khoản Replit để sử dụng
        </p>
      </div>
    </div>
  );
}
