package dev.agenttrust.core;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MissingRequestHeaderException;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler({org.springframework.dao.DataAccessException.class,org.springframework.transaction.TransactionException.class}) ResponseEntity<Map<String,String>> database(Exception error) {return ResponseEntity.status(503).body(Map.of("code","STORAGE_UNAVAILABLE"));}
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<Map<String,String>> status(ResponseStatusException error) {return ResponseEntity.status(error.getStatusCode()).body(Map.of("code","REQUEST_REFUSED"));}
    @ExceptionHandler({MethodArgumentNotValidException.class,HttpMessageNotReadableException.class,MethodArgumentTypeMismatchException.class,MissingRequestHeaderException.class,IllegalArgumentException.class}) ResponseEntity<Map<String,String>> invalid(Exception error) {return ResponseEntity.badRequest().body(Map.of("code","INVALID_REQUEST"));}
    @ExceptionHandler(Exception.class) ResponseEntity<Map<String,String>> unavailable(Exception error) {return ResponseEntity.internalServerError().body(Map.of("code","REQUEST_UNAVAILABLE"));}
}
