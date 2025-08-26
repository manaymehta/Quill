import React, { useState, useEffect } from 'react';
import Navbar from '../../components/Navbar/Navbar';
import { Link, useNavigate } from 'react-router-dom';
import PasswordInput from '../../components/Input/PasswordInput';
import { validateEmail } from '../../utils/helper';
import { useAuthStore } from '../../store/useAuthStore';

const SignUp = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

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
    await googleLogin(response, navigate);
  };

  useEffect(() => {
    if (window.google) {
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: handleGoogleLogin,
      });

      window.google.accounts.id.renderButton(
        document.getElementById('google-login-btn'),
        { theme: 'outline', size: 'large' }
      );
    }
  }, []);

  return (
    <>
      <Navbar isVisible={false} />
      <div className="flex items-center justify-center h-screen bg-neutral-100 pb-20">
        <div className="w-96 p-8 rounded-lg shadow-lg bg-white">
          <form onSubmit={handleSignUp}>
            <h4 className="text-3xl font-semibold mb-7 text-center text-neutral-700">
              Create an Account
            </h4>
            <input
              className="input-box border-neutral-300 focus:border-neutral-500"
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input-box border-neutral-300 focus:border-neutral-500"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {error && <p className="text-red-500 text-xs pb-1">{error}</p>}

            <button
              className="w-full text-lg bg-neutral-600 text-white p-3 rounded-md my-4 hover:bg-neutral-700 transition-colors duration-300"
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? 'Creating Account...' : 'Create Account'}
            </button>

            <p className="text-sm text-center mt-4 text-neutral-600">
              Already have an account?{' '}
              <Link
                to="/"
                className="text-neutral-700 font-medium underline hover:text-neutral-800"
              >
                Log in
              </Link>
            </p>
            <div
              className="mt-5 flex justify-center"
              id="google-login-btn"
            ></div>
          </form>
        </div>
      </div>
    </>
  );
};

export default SignUp;