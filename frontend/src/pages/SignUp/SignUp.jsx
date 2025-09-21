import React, { useState, useEffect, useRef } from 'react';
import Navbar from '../../components/Navbar/Navbar';
import { Link, useNavigate } from 'react-router-dom';
import PasswordInput from '../../components/Input/PasswordInput';
import { validateEmail } from '../../utils/helper';
import { useAuthStore } from '../../store/useAuthStore';

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


const SignUp = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const canvasRef = useRef(null);

  const { signup, googleLogin, error, isLoading } = useAuthStore();

  const handleSignUp = async (e) => {
    e.preventDefault();
    if (!name) {
      useAuthStore.setState({ error: 'Please enter your name' });
      return;
    }
    if (!validateEmail(email)) {
      useAuthStore.setState({ error: 'Please enter a valid email address' });
      return;
    }
    if (!password) {
      useAuthStore.setState({ error: 'Please enter password' });
      return;
    }

    await signup(name, email, password, navigate);
  };

  const handleGoogleLogin = async (response) => {
    // Pass navigate to maintain original functionality
    await googleLogin(response, navigate);
  };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  useEffect(() => {
    if (window.google) {
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: handleGoogleLogin,
      });

      window.google.accounts.id.renderButton(
        document.getElementById('google-login-btn-signup'),
        // Using consistent styling from the Login page
        { theme: 'filled_white', size: 'large', shape: 'pill', width: '352', text: 'signup_with', logo_alignment: 'left' }
      );
    }
  }, []);

  // --- Canvas Background Animation Logic --- //
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const DENSITY = 50;
    const MAX_DISTANCE = 120;
    const SPEED = 0.5;

    let nodes = [];

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      nodes = [];
      initNodes();
    };

    const initNodes = () => {
      for (let i = 0; i < DENSITY; i++) {
        nodes.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
          radius: Math.random() * 2 + 1,
        });
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (const node of nodes) {
        if (node.x + node.radius > canvas.width || node.x - node.radius < 0) {
          node.vx *= -1;
        }
        if (node.y + node.radius > canvas.height || node.y - node.radius < 0) {
          node.vy *= -1;
        }
        node.x += node.vx;
        node.y += node.vy;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();
      }
      
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const dist = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
          if (dist < MAX_DISTANCE) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${1 - dist / MAX_DISTANCE})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    resizeCanvas();
    animate();

    window.addEventListener('resize', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <>
      <div className="font-sans relative flex flex-col items-center justify-center min-h-screen w-full bg-[#212121] overflow-hidden p-4">
        <canvas ref={canvasRef} className="absolute inset-0 z-0"></canvas>
        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full ">
          <div className="bg-[#212121]/80 backdrop-blur-sm border border-white/10 text-[#EAEAEA] p-8 md:p-12 rounded-2xl w-full max-w-md text-center shadow-md flex flex-col items-center">
            
            <QuillIcon className="text-[#FF6B6B] mb-4 -mt-5" />
            <h2 className="w-full text-3xl font-semibold text-white mb-6">Create an Account</h2>
            
            <form onSubmit={handleSignUp} className="w-full">
              <div className="w-full text-left mb-5">
                <label htmlFor="name" className="block mb-2 font-medium text-[#A0A0A0]">Name</label>
                <input 
                  id="name"
                  type="text" 
                  placeholder="Your Name" 
                  className="w-full p-3 rounded-lg border border-[#424242] bg-[#333] text-[#EAEAEA] focus:outline-none focus:border-[#FF6B6B] focus:ring-2 focus:ring-[#FF6B6B]/30 transition-all"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

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
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <p className="mt-6 text-[#A0A0A0]">
              Already have an account?{' '}
              <Link to="/" className="font-semibold text-[#FF6B6B] hover:underline">
                Log In
              </Link>
            </p>

            <div className="flex items-center w-full my-6">
              <div className="flex-grow border-t border-[#424242]"></div>
              <span className="mx-4 text-xs font-medium text-[#A0A0A0]">OR</span>
              <div className="flex-grow border-t border-[#424242]"></div>
            </div>

            <div id="google-login-btn-signup" className="flex justify-center w-full"></div>

          </div>
        </div>
      </div>
    </>
  );
};

export default SignUp;
