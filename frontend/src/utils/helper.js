export const validateEmail = (email) => {
    const regex=  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return regex.test(email);
}

export const getInitials = (name) => {
    if (typeof name !== 'string' || !name.trim()) {
        return ""; // Returns an empty string for null, undefined, or empty/whitespace strings
    }

    const words = name.split(" ");
    let initials ="";

    for(let i=0; i<Math.min(words.length, 2); i++){
        if (words[i] && words[i][0]) {
            initials = initials + words[i][0];
        }
    }

    return initials.toUpperCase();
}