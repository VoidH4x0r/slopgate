/**
 * Top-level modules of the Python standard library (3.9 - 3.14).
 *
 * Kept as a static list on purpose: we never execute the target project's
 * Python interpreter, and the list is stable enough to pin. Anything missing
 * can be added to `ignoreModules` in `.slopgate.json`.
 */
export const PYTHON_STDLIB: ReadonlySet<string> = new Set([
  '__future__', '__main__', '_thread', 'abc', 'aifc', 'annotationlib', 'argparse', 'array',
  'ast', 'asynchat', 'asyncio', 'asyncore', 'atexit', 'audioop', 'base64',
  'bdb', 'binascii', 'bisect', 'builtins', 'bz2', 'cProfile', 'calendar',
  'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code', 'codecs', 'codeop',
  'collections', 'colorsys', 'compileall', 'compression', 'concurrent',
  'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg', 'crypt',
  'csv', 'ctypes', 'curses', 'dataclasses', 'datetime', 'dbm', 'decimal',
  'difflib', 'dis', 'distutils', 'doctest', 'email', 'encodings',
  'ensurepip', 'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp',
  'fileinput', 'fnmatch', 'fractions', 'ftplib', 'functools', 'gc', 'getopt',
  'getpass', 'gettext', 'glob', 'graphlib', 'grp', 'gzip', 'hashlib',
  'heapq', 'hmac', 'html', 'http', 'idlelib', 'imaplib', 'imghdr', 'imp',
  'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json', 'keyword',
  'lib2to3', 'linecache', 'locale', 'logging', 'lzma', 'mailbox', 'mailcap',
  'marshal', 'math', 'mimetypes', 'mmap', 'modulefinder', 'msilib', 'msvcrt',
  'multiprocessing', 'netrc', 'nis', 'nntplib', 'nt', 'ntpath', 'numbers',
  'operator', 'optparse', 'os', 'ossaudiodev', 'pathlib', 'pdb', 'pickle',
  'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib', 'poplib',
  'posix', 'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd',
  'py_compile', 'pyclbr', 'pydoc', 'pyexpat', 'queue', 'quopri', 'random', 're',
  'readline', 'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched',
  'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil', 'signal',
  'site', 'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver', 'spwd',
  'sqlite3', 'sre_compile', 'sre_constants', 'sre_parse', 'ssl', 'stat',
  'statistics', 'statvfs', 'string', 'stringprep', 'struct', 'subprocess',
  'sunau', 'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny', 'tarfile',
  'telnetlib', 'tempfile', 'termios', 'textwrap', 'this', 'threading',
  'time', 'timeit', 'tkinter', 'token', 'tokenize', 'tomllib', 'trace',
  'traceback', 'tracemalloc', 'tty', 'turtle', 'turtledemo', 'types',
  'typing', 'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'venv',
  'warnings', 'wave', 'weakref', 'webbrowser', 'winreg', 'winsound',
  'wsgiref', 'xdrlib', 'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport',
  'zlib', 'zoneinfo',
]);

/**
 * Import path -> distribution name, for packages whose import name differs
 * from the name you put in a manifest. Keys are case-sensitive and may be
 * dotted; the longest matching prefix wins (`google.protobuf` before `google`).
 * Without this map the dependency check would produce false positives on very
 * common packages.
 */
export const IMPORT_TO_DISTRIBUTION: Readonly<Record<string, string>> = {
  attr: 'attrs',
  bs4: 'beautifulsoup4',
  cv2: 'opencv-python',
  Crypto: 'pycryptodome',
  dateutil: 'python-dateutil',
  docx: 'python-docx',
  dotenv: 'python-dotenv',
  fitz: 'pymupdf',
  git: 'gitpython',
  grpc: 'grpcio',
  'google.protobuf': 'protobuf',
  googleapiclient: 'google-api-python-client',
  jose: 'python-jose',
  jwt: 'pyjwt',
  ldap: 'python-ldap',
  magic: 'python-magic',
  MySQLdb: 'mysqlclient',
  nacl: 'pynacl',
  OpenSSL: 'pyopenssl',
  PIL: 'pillow',
  pkg_resources: 'setuptools',
  pptx: 'python-pptx',
  psycopg2: 'psycopg2-binary',
  rest_framework: 'djangorestframework',
  serial: 'pyserial',
  skimage: 'scikit-image',
  sklearn: 'scikit-learn',
  slugify: 'python-slugify',
  socks: 'pysocks',
  win32api: 'pywin32',
  win32com: 'pywin32',
  Xlib: 'python-xlib',
  yaml: 'pyyaml',
  zmq: 'pyzmq',
};

/**
 * Modules that are importable without being declared because the toolchain
 * provides them. `setuptools` ships `pkg_resources` and `_distutils_hack`.
 */
export const IMPLICIT_MODULES: ReadonlySet<string> = new Set([
  '_distutils_hack', 'pkg_resources', 'setuptools', 'pip', 'wheel',
]);
