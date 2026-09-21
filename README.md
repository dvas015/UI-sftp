# SFTP Explorer

Interface web para conexão, navegação e gerenciamento de arquivos em servidores SFTP.

O projeto é desenvolvido para a disciplina de **Computação em Nuvem** do curso de **Engenharia de Computação do CEFET-MG - Campus Leopoldina**. Seu objetivo é disponibilizar uma interface amigável no navegador para acessar um servidor SFTP executado em uma infraestrutura virtualizada com Proxmox.

## Objetivo

O SFTP Explorer permite que o usuário informe o host, a porta, o nome de usuário e a senha de uma conta SFTP. Após a autenticação, a aplicação abre o diretório padrão dessa conta e oferece operações de gerenciamento de arquivos sem exigir o uso de um cliente SFTP de linha de comando.

O projeto também demonstra, de forma prática, a comunicação entre serviços executados em contêineres LXC distintos, o uso do NGINX como servidor web e proxy reverso e a integração entre uma aplicação HTTP e um serviço SFTP/SSH.

## Arquitetura planejada

```mermaid
flowchart LR
    U[Usuário no navegador]
    N[NGINX<br/>porta 80]
    R[Frontend<br/>React + Vite]
    A[API<br/>FastAPI + Paramiko]
    S[Servidor SFTP<br/>OpenSSH]

    subgraph WEB[Contêiner LXC Web]
        N
        R
        A
    end

    subgraph FILES[Contêiner LXC SFTP]
        S
    end

    U -->|HTTP/1.1| N
    N --> R
    N -->|/api| A
    A -->|SFTP/SSH| S
```

A infraestrutura final será formada por dois contêineres LXC no Proxmox:

1. **Contêiner SFTP:** Ubuntu Server com OpenSSH/SFTP e os arquivos remotos.
2. **Contêiner Web:** NGINX, frontend React e API FastAPI responsável pela comunicação com o servidor SFTP por meio do Paramiko.

O NGINX servirá os arquivos estáticos gerados pelo frontend e encaminhará as requisições da API para o FastAPI. O backend não ficará diretamente exposto à rede.

## Funcionalidades previstas

### Conexão

- Informar host ou endereço IP, porta, usuário e senha pela interface.
- Validar a conexão antes de abrir o gerenciador.
- Acessar inicialmente o diretório padrão da conta SFTP.
- Exibir o estado da conexão e informações do servidor.
- Encerrar a conexão manualmente.

### Gerenciamento de arquivos

- Navegar entre diretórios por meio de pastas e breadcrumbs.
- Listar nome, tipo, tamanho, data de modificação e permissões dos itens.
- Pesquisar arquivos no diretório atual.
- Filtrar arquivos por categoria, como documentos, imagens, vídeos, áudios e compactados.
- Enviar arquivos ao servidor.
- Baixar arquivos.
- Criar diretórios.
- Renomear arquivos e diretórios.
- Excluir arquivos.
- Excluir diretórios vazios.

### Visão geral e atividade

- Exibir arquivos modificados recentemente.
- Calcular a quantidade e o tamanho dos arquivos acessíveis.
- Apresentar a distribuição dos arquivos por categoria.
- Registrar uploads e downloads realizados durante a sessão atual.

As categorias serão identificadas principalmente pela extensão dos arquivos. Os totais e a distribuição exigem uma leitura recursiva da árvore acessível e podem levar mais tempo em diretórios grandes. A atividade exibida representa somente as ações feitas pela aplicação durante a sessão, e não um histórico global do servidor SFTP.

## Ações disponíveis

| Item | Ações |
| --- | --- |
| Arquivo | Baixar, renomear e excluir |
| Diretório | Abrir, renomear e excluir quando estiver vazio |

Todas as operações respeitam as permissões Linux da conta autenticada. A interface não concede ao usuário permissões que ele não possua no servidor.

## Sessões e credenciais

- Cada navegador terá uma sessão independente no backend.
- Uma mesma conta SFTP poderá ser usada em conexões simultâneas.
- Um navegador poderá manter vários servidores cadastrados, cada um com um identificador próprio associado à sessão web.
- As configurações e credenciais serão mantidas somente na memória do backend e associadas a um cookie de sessão `HttpOnly`.
- A senha não será salva em banco de dados, arquivo, `localStorage` ou `sessionStorage`.
- Não haverá uma conexão SFTP persistente: cada operação abrirá uma conexão, executará a ação e a fechará em seguida.
- **Desconectar** removerá a senha, mas manterá nome, host, porta e usuário para permitir uma reconexão posterior.
- Excluir um servidor removerá todo o cadastro; encerrar a sessão web removerá todos os servidores e credenciais associados.
- Não há expiração automática. Se o navegador for fechado sem encerrar a sessão, os dados ficarão órfãos na memória até o backend reiniciar.
- Não haverá bloqueio de arquivos. Operações simultâneas sobre o mesmo caminho poderão causar conflitos.

## Limitações de segurança

Esta versão utiliza **HTTP sem TLS** entre o navegador e o NGINX, conforme o escopo didático da disciplina. Embora a comunicação entre o backend e o servidor SFTP seja protegida por SSH, os dados enviados pelo navegador, incluindo a senha, não são criptografados pelo HTTP.

Por esse motivo:

- a aplicação deve permanecer restrita à rede interna do laboratório ou a outro ambiente controlado;
- não deve ser publicada diretamente na internet;
- devem ser utilizadas apenas contas criadas para o ambiente da disciplina;
- credenciais e dados pessoais não devem aparecer em logs ou mensagens de erro.
- nesta primeira versão, chaves SSH desconhecidas são aceitas automaticamente e não são persistidas, portanto a identidade do servidor não é protegida contra ataques de intermediário.

HTTPS, autenticação por chave e armazenamento compartilhado de sessões são melhorias previstas para uma possível evolução do projeto.

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Virtualização | Proxmox VE e contêineres LXC |
| Servidor SFTP | Ubuntu Server e OpenSSH/SFTP |
| Frontend | React, TypeScript e Vite |
| Interface | CSS e Lucide React |
| Backend | Python 3.12, FastAPI e Paramiko |
| Servidor web | NGINX |
| Inicialização do backend | `systemd` |
| Protocolo web | HTTP/1.1 |
| Protocolo de arquivos | SFTP sobre SSH |

O projeto não utiliza banco de dados nem serviços de nuvem pública nesta etapa.

## Estado atual

| Etapa | Estado |
| --- | --- |
| Instalação do Proxmox no laboratório | Concluída |
| Criação do contêiner LXC com Ubuntu Server | Concluída |
| Configuração e teste do servidor SFTP | Concluídos |
| Máquina virtual Ubuntu Server/SFTP no VirtualBox para testes locais | Disponível |
| Interface React para sessões e navegação | Concluída |
| Integração de conexões e listagem de diretórios | Concluída |
| Criação do segundo contêiner LXC | Pendente |
| API base de sessões e conexões FastAPI/Paramiko | Concluída |
| Upload, download e mutações de arquivos na API | Concluídos |
| Configuração do NGINX | Pendente |
| Criação do serviço `systemd` | Pendente |
| Implantação e testes integrados no laboratório | Pendente |

O frontend usa a API para cadastrar servidores, validar credenciais, navegar por diretórios e executar upload, download, criação, movimentação, duplicação, renomeação, alteração de permissões e exclusão.

## Executando o frontend

### Iniciar tudo de uma vez no Windows

Na raiz do projeto, execute:

```powershell
.\start-dev.ps1
```

O script inicia o backend e o frontend no mesmo terminal. Pressione `Ctrl+C` para encerrar os dois processos. Se a política de execução do PowerShell bloquear scripts locais, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

### Iniciar somente o frontend

Com Node.js e npm instalados:

```bash
cd front
npm install
npm run dev
```

O Vite exibirá no terminal o endereço local da aplicação.

Outros comandos disponíveis:

```bash
# Verificar o código com o linter
npm run lint

# Gerar a versão de produção
npm run build

# Visualizar localmente a versão gerada
npm run preview
```

## Executando o backend

O backend usa um ambiente virtual e dependências instaladas com `pip`:

```bash
cd backend
python -m venv .venv

# Linux
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1

python -m pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload
```

A documentação interativa estará disponível em `http://127.0.0.1:8000/docs`. A aplicação deve sempre usar um único worker enquanto as sessões forem armazenadas em memória.

Para executar os testes:

```bash
cd backend
python -m pytest
```

### API inicial

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/api/health` | Verificar a disponibilidade da API |
| `POST` | `/api/connections` | Validar e cadastrar um servidor |
| `GET` | `/api/connections` | Listar os servidores da sessão |
| `GET` | `/api/connections/{id}` | Consultar um servidor |
| `GET` | `/api/connections/{id}/files?path=...` | Listar um diretório remoto |
| `GET` | `/api/connections/{id}/files/download?path=...` | Baixar um arquivo remoto |
| `POST` | `/api/connections/{id}/files/upload?path=...` | Enviar um arquivo |
| `POST` | `/api/connections/{id}/directories` | Criar um diretório |
| `PATCH` | `/api/connections/{id}/entries/rename` | Renomear arquivo ou diretório |
| `POST` | `/api/connections/{id}/entries/move` | Mover arquivo ou diretório |
| `POST` | `/api/connections/{id}/entries/duplicate` | Duplicar arquivo ou diretório |
| `PATCH` | `/api/connections/{id}/entries/permissions` | Alterar permissões octais |
| `POST` | `/api/connections/{id}/entries/delete` | Excluir arquivo ou diretório vazio |
| `PATCH` | `/api/connections/{id}` | Editar e, quando necessário, revalidar o servidor |
| `POST` | `/api/connections/{id}/disconnect` | Apagar a senha e preservar o cadastro |
| `POST` | `/api/connections/{id}/connect` | Revalidar com uma nova senha |
| `DELETE` | `/api/connections/{id}` | Excluir um servidor |
| `DELETE` | `/api/session` | Encerrar a sessão web e apagar todos os dados |

O cookie `sftp_session` é restrito a `/api`, `HttpOnly` e `SameSite=Strict`. Ele não possui expiração persistente. Como a implantação acadêmica usa HTTP, o atributo `Secure` permanece desativado.

## Estrutura atual

```text
.
|-- backend/
|   |-- app/                 # API, modelos, sessões e cliente SFTP
|   |-- tests/               # Testes isolados com Paramiko simulado
|   |-- requirements.txt
|   `-- requirements-dev.txt
|-- front/
|   |-- public/              # Arquivos estáticos
|   |-- src/                 # Aplicação React e cliente da API
|   |-- package.json
|   `-- vite.config.ts       # Proxy local de /api para o FastAPI
`-- README.md
```

A estrutura ainda será ampliada com as operações remotas e os arquivos de configuração necessários para NGINX e `systemd`.


## Contexto acadêmico

- **Instituição:** CEFET-MG - Campus Leopoldina
- **Curso:** Engenharia de Computação
- **Disciplina:** Computação em Nuvem
- **Professor:** Daniel Henriques
- **Autores:** Daniel Vasconcelos e Viktor Reckziegel
