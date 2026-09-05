import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '../../components/Navbar/Navbar';
import { Link, useNavigate } from 'react-router-dom';
import { validateEmail } from '../../utils/helper';
import PasswordInput from '../../components/Input/PasswordInput';
import { useAuthStore } from '../../store/useAuthStore';
import ParticleBackground from '../../components/Background/ParticleBackground';

const QuillIcon = ({ className }) => (
  <svg
    className={className}
    width="48" height="48" viewBox="0 0 24 24"
    fill="none" xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M4.75 19.25L9 18.25L18.2929 8.95711C18.6834 8.56658 18.6834 7.93342 18.2929 7.54289L16.4571 5.70711C16.0666 5.31658 15.4334 5.31658 15.0429 5.70711L5.75 15L4.75 19.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
    <path d="M14 7L17 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
  </svg>
);


const Login = () => {
  const [isMounted, setIsMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const { login, googleLogin, error, isLoading, isLoggedIn } = useAuthStore();

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!validateEmail(email)) {
      useAuthStore.setState({ error: 'Please enter a valid email address' });
      return;
    }
    if (!password) {
      useAuthStore.setState({ error: 'Please enter password' });
      return;
    }

    await login(email, password);
  };

  const handleGoogleLogin = useCallback(async (response) => {
    await googleLogin(response);
  }, [googleLogin]);

  const googleInitialized = useRef(false);

  useEffect(() => {
    if (window.google && !googleInitialized.current) {
      googleInitialized.current = true;
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: handleGoogleLogin,
      });
      window.google.accounts.id.renderButton(
        document.getElementById('google-login-btn'),
        { theme: 'filled_white', size: 'large', shape: 'pill', width: '352', text: 'signin_with', logo_alignment: 'left' }
      );
    }
  }, [handleGoogleLogin]);

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/dashboard');
    }
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  return (
    <>
      {isLoggedIn && <Navbar isVisible={false} />}
      <div className="font-sans relative flex flex-col items-center justify-center min-h-screen w-full bg-[#212121] overflow-hidden p-4">
        <ParticleBackground className="absolute inset-0 z-0 pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full ">
          <div className={`bg-[#212121]/80 backdrop-blur-sm border border-white/10 text-[#EAEAEA] p-8 md:p-12 rounded-2xl w-full max-w-md text-center shadow-md flex flex-col items-center transition-all duration-700 ease-out transform ${isMounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'}`}>

            <QuillIcon className="text-[#FF6B6B] mb-4" />
            <h2 className="w-full text-3xl font-semibold text-white mb-6">Welcome Back to <span className='text-[#FF6B6B]'>Quill</span></h2>

            <form onSubmit={handleLogin} className="w-full">
              <div className="w-full text-left mb-5">
                <label htmlFor="email" className="block mb-2 font-medium text-[#A0A0A0]">Email</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  className="w-full p-3 rounded-lg border border-[#424242] bg-[#333] text-[#EAEAEA] focus:outline-none focus:border-[#FF6B6B] focus:ring-2 focus:ring-[#FF6B6B]/30 transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="w-full text-left mb-5">
                <label className="block mb-2 font-medium text-[#A0A0A0]">Password</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  inputClassName="w-full p-3 rounded-lg border border-[#424242] bg-[#333] text-[#EAEAEA] focus-within:outline-none focus-within:border-[#FF6B6B] focus-within:ring-2 focus-within:ring-[#FF6B6B]/30 transition-all"
                  eyeIconClassName="text-[#A0A0A0] hover:text-white"
                />
              </div>

              {error && <p className="text-red-500 text-sm text-left w-full mb-4">{error}</p>}

              <button
                type="submit"
                className="w-full mt-2 py-3 px-6 bg-[#FF6B6B] text-white font-semibold rounded-xl transition-all duration-200 hover:brightness-110 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isLoading}
              >
                {isLoading ? 'Logging in...' : 'Log In'}
              </button>
            </form>

            <p className="mt-6 text-[#A0A0A0]">
              Not registered yet?{' '}
              <Link to="/signup" className="font-semibold text-[#FF6B6B] hover:underline">
                Create an account
              </Link>
            </p>

            <div className="flex items-center w-full my-6">
              <div className="flex-grow border-t border-[#424242]"></div>
              <span className="mx-4 text-xs font-medium text-[#A0A0A0]">OR</span>
              <div className="flex-grow border-t border-[#424242]"></div>
            </div>

            <div id="google-login-btn" className="flex justify-center w-full"></div>

          </div>
        </div>
      </div>
    </>
  );
};

export default Login;

