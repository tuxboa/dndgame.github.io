/*
  * Copyright 2009 Udo Schroeter <udo.schroeter@gmail.com>
  *
  * Redistribution and use in source and binary forms, with or without
  * modification, are permitted provided that the following conditions
  * are met:
  * 1. Redistributions of source code must retain the above copyright  
  *    notice, this list of conditions and the following disclaimer.
  * 2. Redistributions in binary form must reproduce the above copyright
  *    notice, this list of conditions and the following disclaimer in the
  *    documentation and/or other materials provided with the distribution.
  *
  * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
  * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
  * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
  * IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
  * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
  * NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/* File: Main.cs
 * Classes: 
 *   MainClass - simple console application that shows off the DiceParser class
 * */

using System;

namespace DiceRoller
{
	class MainClass
	{
		public static void Main (string[] args)
		{
			DiceParser dp = new DiceParser();
			// try some complicated die code for testing
			dp.parse("10d10r15+10d6+4-2+2d6e6+5d6:8s10+10d10s7+STR+UNDEF");
			// all variables in the vartable need to be lower case!
			dp.varTable["str"] = 10;
			// output the result
			Console.WriteLine (dp.roll());
			// show the log
			foreach(string line in dp.errorLog)
				Console.WriteLine(line);
		}
	}
}
