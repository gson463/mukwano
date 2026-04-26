// This file is deprecated and should be ignored. 
// The active context file is located at src/contexts/SupabaseAuthContext.jsx
// Please do not use this file.
export const AuthProvider = ({ children }) => {
  return <>{children}</>;
};

export const useAuth = () => {
  throw new Error("This is a deprecated file. Import from @/contexts/SupabaseAuthContext instead.");
};