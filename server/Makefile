.PHONY: all


SRC = src/binding.cc \
	src/Rconnection.cc

LDFLAGS = -shared -L/usr/lib/R/lib -L/usr/local/lib -lR -lcrypt
CPPFLAGS = -I/usr/local/include/node -Isrc/include -DPIC -fPIC -g -c -DEV_MULTIPLICITY=0

%.o : %.c
	$(CC) -c $(CFLAGS) $(CPPFLAGS) $< -o $@

all: binding.node
	mkdir -p ../deploy
	mkdir -p ../deploy/lib
	cd ../deploy && cp ../server/binding.node . && \
	ln -s ../server/etc . && \
	cp -r ../server/authenticators . && \
	cp -r ../server/handlers . && \
	cp -r ../3rdparty/multipart lib && \
	cp ../server/*.js . && \
	cp ../server/run-server.sh . && \
	cd - 

binding.node: src/binding.o src/Rconnection.o
	gcc -o binding.node src/binding.o src/Rconnection.o $(LDFLAGS)

clean:
	rm src/*.o
	rm binding.node

