"""Validate an existing operator-owned development backup key without changing it."""
import hashlib
import os
import pathlib


def windows_owner_only(items):
    """Read native DACLs; do not change ACLs or shell execution policies."""
    import ctypes
    from ctypes import wintypes
    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    pointer = ctypes.c_void_p
    advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, pointer, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    advapi.ConvertStringSidToSidW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(pointer)]
    advapi.GetNamedSecurityInfoW.argtypes = [wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD, pointer, pointer, ctypes.POINTER(pointer), pointer, ctypes.POINTER(pointer)]
    advapi.GetNamedSecurityInfoW.restype = wintypes.DWORD
    advapi.GetAce.argtypes = [pointer, wintypes.DWORD, ctypes.POINTER(pointer)]
    advapi.EqualSid.argtypes = [pointer, pointer]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.LocalFree.argtypes = [pointer]
    kernel.LocalFree.restype = pointer
    token, system = wintypes.HANDLE(), pointer()
    try:
        if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
            raise ValueError('Backup key token inspection refused')
        needed = wintypes.DWORD()
        advapi.GetTokenInformation(token, 1, None, 0, ctypes.byref(needed))
        if not 0 < needed.value <= 65536:
            raise ValueError('Backup key token size refused')
        token_user = ctypes.create_string_buffer(needed.value)
        if not advapi.GetTokenInformation(token, 1, token_user, needed, ctypes.byref(needed)):
            raise ValueError('Backup key token inspection refused')
        owner = pointer.from_buffer(token_user).value
        if not advapi.ConvertStringSidToSidW('S-1-5-18', ctypes.byref(system)):
            raise ValueError('Backup key system identity refused')
        for item in items:
            descriptor, dacl = pointer(), pointer()
            try:
                if advapi.GetNamedSecurityInfoW(str(item), 1, 4, None, None, ctypes.byref(dacl), None, ctypes.byref(descriptor)) or not dacl:
                    raise ValueError('Backup key ACL inspection refused')
                # ACL header: BYTE revision, BYTE reserved, WORD size, WORD AceCount.
                count = ctypes.c_ushort.from_address(dacl.value + 4).value
                owner_allowed = False
                if not 0 < count <= 1024:
                    raise ValueError('Backup key ACL size refused')
                for index in range(count):
                    ace = pointer()
                    if not advapi.GetAce(dacl, index, ctypes.byref(ace)):
                        raise ValueError('Backup key ACL entry refused')
                    kind = ctypes.c_ubyte.from_address(ace.value).value
                    if kind == 1:  # Deny entries cannot broaden access.
                        continue
                    if kind != 0 or ctypes.c_ushort.from_address(ace.value + 2).value < 16:
                        raise ValueError('Unsupported backup key ACL entry')
                    sid = ace.value + 8  # ACCESS_ALLOWED_ACE.SidStart.
                    current = bool(advapi.EqualSid(sid, owner))
                    if not current and not advapi.EqualSid(sid, system):
                        raise ValueError('Backup key broad access refused')
                    owner_allowed |= current
                if not owner_allowed:
                    raise ValueError('Backup key owner access missing')
            finally:
                if descriptor:
                    kernel.LocalFree(descriptor)
    finally:
        if token:
            kernel.CloseHandle(token)
        if system:
            kernel.LocalFree(system)


def retained_key(root, value):
    root = pathlib.Path(root).resolve()
    path = pathlib.Path(value)
    if not path.is_absolute():
        path = root / path
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError('Linked backup key refused')
    path = path.resolve(strict=True)
    if path.parent.parent != (root / '.local').resolve() or not path.is_file() or path.stat().st_size != 32:
        raise ValueError('Backup key location or size refused')
    if os.name == 'nt':
        windows_owner_only((path, path.parent))
    else:
        for item in (path, path.parent):
            info = item.stat()
            if info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError('Backup key custody permissions refused')
    with path.open('rb') as stream:
        value = stream.read(33)
    if len(value) != 32:
        raise ValueError('Backup key changed during validation')
    return path, hashlib.sha256(value).digest()


def key_unchanged(path, fingerprint):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != 32:
        return False
    return hashlib.sha256(path.read_bytes()).digest() == fingerprint
