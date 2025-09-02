document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('formCadastro');
    const passwordInput = document.getElementById('senha');
    const confirmPasswordInput = document.getElementById('confirmarSenha');
    const togglePasswordBtn = document.getElementById('togglePassword');
    const successModal = document.getElementById('successModal');
    const closeModalBtn = document.getElementById('closeModal');

    const strengthBars = [
        document.getElementById('strength-1'),
        document.getElementById('strength-2'),
        document.getElementById('strength-3'),
        document.getElementById('strength-4')
    ];
    const strengthText = document.getElementById('password-strength-text');

    // 👉 Função para calcular a força da senha
    function calcularForcaSenha(senha) {
        let forca = 0;
        if (senha.length >= 6) forca++;
        if (/[A-Z]/.test(senha)) forca++;
        if (/[0-9]/.test(senha)) forca++;
        if (/[^A-Za-z0-9]/.test(senha)) forca++;
        return forca;
    }

    // 👉 Atualiza os indicadores de força da senha
    passwordInput.addEventListener('input', function () {
        const senha = passwordInput.value;
        const forca = calcularForcaSenha(senha);

        // Resetar cores
        strengthBars.forEach(bar => {
            bar.classList.remove('bg-red-500', 'bg-yellow-500', 'bg-green-500');
            bar.classList.add('bg-gray-200');
        });

        if (forca === 1) {
            strengthBars[0].classList.add('bg-red-500');
            strengthText.innerText = 'Fraca';
            strengthText.className = 'text-red-600 text-xs';
        } else if (forca === 2) {
            strengthBars[0].classList.add('bg-yellow-500');
            strengthBars[1].classList.add('bg-yellow-500');
            strengthText.innerText = 'Média';
            strengthText.className = 'text-yellow-600 text-xs';
        } else if (forca >= 3) {
            strengthBars.forEach(bar => bar.classList.add('bg-green-500'));
            strengthText.innerText = 'Forte';
            strengthText.className = 'text-green-600 text-xs';
        } else {
            strengthText.innerText = 'Força da senha';
            strengthText.className = 'text-xs text-gray-500';
        }
    });

    // 👉 Mostrar ou ocultar senha
    togglePasswordBtn.addEventListener('click', function () {
        const tipo = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', tipo);
        togglePasswordBtn.classList.toggle('text-blue-600');
    });

    // 👉 Submissão do formulário
    form.addEventListener('submit', function (e) {
        e.preventDefault();

        if (passwordInput.value !== confirmPasswordInput.value) {
            alert('As senhas não coincidem. Por favor, verifique.');
            return;
        }

        const nome = document.getElementById('nome').value;
        const email = document.getElementById('email').value;
        const senha = passwordInput.value;

        const payload = {
            first_name: nome,
            email: email,
            username: email,
            password: senha,
            perfil: 'master'
        };

        fetch(`${window.API_BASE_URL}/api/usuarios/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(response => {
                if (response.ok) {
                    successModal.classList.remove('hidden');
                } else {
                    response.json().then(data => {
                        let msg = 'Erro ao criar conta:\n';
                        for (const key in data) {
                            msg += `${key}: ${data[key]}\n`;
                        }
                        alert(msg);
                    });
                }
            })
            .catch(error => {
                alert('Erro de conexão com o servidor.');
                console.error(error);
            });
    });

    // 👉 Fechar modal de sucesso
    closeModalBtn.addEventListener('click', function () {
        successModal.classList.add('hidden');
        form.reset();

        strengthBars.forEach(bar => {
            bar.classList.remove('bg-red-500', 'bg-yellow-500', 'bg-green-500');
            bar.classList.add('bg-gray-200');
        });

        strengthText.textContent = 'Força da senha';
        strengthText.className = 'text-xs text-gray-500';
    });
});
